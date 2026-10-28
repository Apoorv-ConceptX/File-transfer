import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { Drive, DriveError, escapeQuery } from "./drive";
import { hash } from "./crypto";
import { included, matches, targetPath, safeSegment, renamed } from "./rules";
import { FOLDER, SHORTCUT, type Job, type Item, type DriveFile } from "./types";
export type Tick = { jobId: string; generation: number; sequence: number };
export type TickResult = {
  more: boolean;
  generation: number;
  sequence: number;
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Unknown processing error";
async function active(job: Job) {
  const [row] = await query("SELECT status,generation FROM jobs WHERE id=$1", [
    job.id,
  ]);
  return (
    row?.generation === job.generation &&
    ["scanning", "copying"].includes(row.status)
  );
}
async function addFile(
  job: Job,
  file: DriveFile,
  relative: string,
  folderRows: number[] = [],
) {
  if (!included(file.name, job.config)) return;
  const selected = job.config.selection
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) =>
      job.config.matchBy === "folder"
        ? folderRows.includes(index)
        : matches(file, row, job.config),
    );
  if (job.config.selection.length && !selected.length) return;
  const id = randomUUID();
  const shortcut = file.mimeType === SHORTCUT;
  const [item] = await query<{ id: string }>(
    `INSERT INTO items(id,job_id,source_id,name,relative_path,target_path,mime_type,bytes,checksum,metadata,status,error)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(job_id,source_id) DO UPDATE SET source_id=EXCLUDED.source_id RETURNING id`,
    [
      id,
      job.id,
      file.id,
      file.name,
      relative,
      targetPath(job.config, relative, selected[0]?.row),
      file.mimeType,
      file.size ?? null,
      file.md5Checksum ?? null,
      JSON.stringify(file),
      shortcut ? "skipped" : "pending",
      shortcut
        ? "Nested shortcut not followed. Supply its link as a separate source."
        : null,
    ],
  );
  for (const match of selected)
    await query(
      `INSERT INTO selection_matches(job_id,row_index,item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [job.id, match.index, item.id],
    );
}
async function finalizeScan(job: Job) {
  if (job.config.selection.length) {
    // One file assigned to different destinations is ambiguous. Duplicate identical rows are harmless.
    const paths = new Map<string, Set<number>>();
    job.config.selection.forEach((row, i) => {
      const key =
        job.config.layout === "structure" || job.config.layout === "batch"
          ? targetPath(job.config, "", row)
          : "";
      if (!paths.has(key)) paths.set(key, new Set());
      paths.get(key)!.add(i);
    });
    if (paths.size > 1) {
      const matches = await query<{ item_id: string; row_index: number }>(
        "SELECT item_id,row_index FROM selection_matches WHERE job_id=$1",
        [job.id],
      );
      const destinations = new Map<string, Set<string>>();
      for (const m of matches) {
        if (!destinations.has(m.item_id))
          destinations.set(m.item_id, new Set());
        destinations
          .get(m.item_id)!
          .add(targetPath(job.config, "", job.config.selection[m.row_index]));
      }
      for (const [itemId, dirs] of destinations)
        if (dirs.size > 1)
          await query(
            "UPDATE items SET status='ambiguous',error='Matched selection rows specify different destination folders' WHERE id=$1 AND status='pending'",
            [itemId],
          );
    }
    // Equipment IDs intentionally select many images; filename / file ID references must be unique.
    if (!["equipment", "folder"].includes(job.config.matchBy))
      await query(
        `UPDATE items SET status='ambiguous',error='Selection value matched multiple source files; use exact filenames or file IDs'
      WHERE job_id=$1 AND status='pending' AND id IN (
        SELECT m.item_id FROM selection_matches m JOIN
        (SELECT row_index FROM selection_matches WHERE job_id=$1 GROUP BY row_index HAVING count(*)>1) a USING(row_index)
        WHERE m.job_id=$1)`,
        [job.id],
      );
  }
  await query(
    `UPDATE jobs SET status=$2,updated_at=now() WHERE id=$1 AND generation=$3 AND status='scanning'`,
    [job.id, job.kind === "copy" ? "ready" : "completed", job.generation],
  );
}
async function scanPage(job: Job, drive: Drive) {
  const [folder] = await query<{
    id: string;
    folder_id: string;
    relative_path: string;
    page_token: string | null;
    selected_rows: number[];
  }>(
    "SELECT * FROM scan_queue WHERE job_id=$1 AND done=false ORDER BY id LIMIT 1",
    [job.id],
  );
  if (!folder) {
    await finalizeScan(job);
    return false;
  }
  const root = await drive.get(folder.folder_id);
  if (root.mimeType !== FOLDER) {
    await addFile(job, root, "", folder.selected_rows);
    await query("UPDATE scan_queue SET done=true WHERE id=$1", [folder.id]);
    return true;
  }
  const rootRows = job.config.selection.flatMap((r, i) =>
    r.value.toLowerCase() === root.name.toLowerCase() || r.value === root.id
      ? [i]
      : [],
  );
  const selectedRows = [...new Set([...folder.selected_rows, ...rootRows])];
  const page = await drive.list(
    folder.folder_id,
    folder.page_token ?? undefined,
  );
  if (page.incompleteSearch)
    throw new Error(
      "Drive returned incomplete search results. Resume to retry.",
    );
  for (const file of page.files) {
    if (file.mimeType === FOLDER) {
      if (
        !job.config.recursive ||
        job.config.excludedFolders.some(
          (n) => n.toLowerCase() === file.name.toLowerCase(),
        )
      )
        continue;
      const relative = [folder.relative_path, safeSegment(file.name)]
        .filter(Boolean)
        .join("/");
      const [collision] = await query(
        "SELECT folder_id FROM scan_queue WHERE job_id=$1 AND relative_path=$2 AND folder_id<>$3",
        [job.id, relative, file.id],
      );
      if (collision)
        throw new Error(
          `Two source folders have the same output path: ${relative}. Select unambiguous source folders.`,
        );
      const childRows = job.config.selection.flatMap((r, i) =>
        r.value.toLowerCase() === file.name.toLowerCase() || r.value === file.id
          ? [i]
          : [],
      );
      await query(
        "INSERT INTO scan_queue(job_id,folder_id,relative_path,selected_rows) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,folder_id) DO NOTHING",
        [
          job.id,
          file.id,
          relative,
          JSON.stringify([...new Set([...selectedRows, ...childRows])]),
        ],
      );
    } else await addFile(job, file, folder.relative_path, selectedRows);
  }
  await query("UPDATE scan_queue SET page_token=$2,done=$3 WHERE id=$1", [
    folder.id,
    page.nextPageToken ?? null,
    !page.nextPageToken,
  ]);
  return true;
}
async function destinationFolder(
  job: Job,
  drive: Drive,
  path: string,
): Promise<string> {
  const [known] = await query(
    "SELECT folder_id FROM destination_folders WHERE job_id=$1 AND path=$2",
    [job.id, path],
  );
  if (known) return known.folder_id;
  const parts = path.split("/"),
    name = parts.pop()!,
    parent = await destinationFolder(job, drive, parts.join("/"));
  const existing = await drive.allMatching(
    parent,
    `name='${escapeQuery(name)}' and mimeType='${FOLDER}'`,
  );
  if (existing.length > 1)
    throw new Error(
      `Destination contains duplicate folder names: ${path}. Resolve them and resume.`,
    );
  const folder =
    existing[0] ??
    (await drive.createFolder(name, parent, hash(job.id + ":" + path)));
  await query(
    "INSERT INTO destination_folders(job_id,path,folder_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [job.id, path, folder.id],
  );
  return folder.id;
}
async function copyItem(job: Job, drive: Drive, item: Item) {
  const parent = await destinationFolder(job, drive, item.target_path),
    marker = hash(job.id + ":" + item.id);
  // Reconcile a copy whose HTTP response or database write was lost.
  const marked = await drive.allMatching(
    parent,
    `appProperties has { key='toolkit_item' and value='${marker}' }`,
  );
  if (marked.length > 1)
    throw new Error(
      "Multiple marked copies found; review destination before retrying.",
    );
  let copied = marked[0];
  if (!copied) {
    let name = item.name;
    const existing = await drive.allMatching(
      parent,
      `name='${escapeQuery(name)}'`,
    );
    if (existing.length) {
      if (job.config.conflicts === "skip") {
        await query(
          "UPDATE items SET status='skipped',error='A destination item already has this name; content was not compared' WHERE id=$1",
          [item.id],
        );
        return;
      }
      if (job.config.conflicts === "error")
        throw new Error(
          "An item with this name already exists in the destination",
        );
      name = renamed(name, item.source_id);
      const renamedExisting = await drive.allMatching(
        parent,
        `name='${escapeQuery(name)}'`,
      );
      if (renamedExisting.length)
        throw new Error(
          "The collision-safe renamed filename also exists. Choose a different destination or skip policy.",
        );
    }
    // A preview is a snapshot: refuse changed binary sources rather than silently copying a new revision.
    const current = await drive.get(item.source_id);
    if (
      current.trashed ||
      current.mimeType !== item.mime_type ||
      (item.checksum && current.md5Checksum !== item.checksum) ||
      (item.bytes !== null && current.size !== String(item.bytes)) ||
      current.modifiedTime !== item.metadata.modifiedTime
    )
      throw new Error(
        "Source changed after preview. Create a new preview to copy the current version.",
      );
    copied = await drive.copy(item.source_id, name, parent, marker);
  }
  if (
    (item.checksum && copied.md5Checksum !== item.checksum) ||
    (item.bytes !== null && copied.size !== String(item.bytes))
  )
    throw new Error(
      "Copy verification failed: size or checksum differs. Review the destination copy.",
    );
  await query(
    "UPDATE items SET status='copied',destination_id=$2,error=null WHERE id=$1",
    [item.id, copied.id],
  );
}
async function copyBatch(job: Job, drive: Drive) {
  // Empty folders are preserved only for unfiltered whole-tree copies.
  if (
    job.config.layout === "preserve" &&
    !job.config.selection.length &&
    !job.config.includeExtensions.length &&
    !job.config.excludeExtensions.length &&
    !job.config.nameIncludes
  ) {
    const dirs = await query<{ relative_path: string }>(
      `SELECT DISTINCT relative_path FROM scan_queue q WHERE job_id=$1 AND relative_path<>''
      AND NOT EXISTS(SELECT 1 FROM destination_folders d WHERE d.job_id=q.job_id AND d.path=q.relative_path)
      ORDER BY relative_path LIMIT 3`,
      [job.id],
    );
    if (dirs.length) {
      for (const dir of dirs) {
        if (!(await active(job))) return false;
        await destinationFolder(job, drive, dir.relative_path);
      }
      return true;
    }
  }
  const items = await query<Item>(
    "SELECT * FROM items WHERE job_id=$1 AND status='pending' ORDER BY id LIMIT 5",
    [job.id],
  );
  if (!items.length) {
    await query(
      "UPDATE jobs SET status='completed',updated_at=now() WHERE id=$1 AND generation=$2 AND status='copying'",
      [job.id, job.generation],
    );
    return false;
  }
  for (const item of items) {
    if (!(await active(job))) return false;
    try {
      await copyItem(job, drive, item);
    } catch (e) {
      // Rate limits/network/authorization failures pause at this item via durable retries; never swallow these.
      if (
        !(e instanceof Error) ||
        (e instanceof DriveError && (e.transient || e.status === 401)) ||
        e.name === "TimeoutError" ||
        e.name === "TypeError"
      )
        throw e;
      await query("UPDATE items SET status='error',error=$2 WHERE id=$1", [
        item.id,
        errorText(e),
      ]);
    }
  }
  return true;
}
export async function processTick(tick: Tick): Promise<TickResult> {
  const [done] = await query<{ outcome: TickResult }>(
    "SELECT outcome FROM job_ticks WHERE job_id=$1 AND generation=$2 AND sequence=$3",
    [tick.jobId, tick.generation, tick.sequence],
  );
  if (done) return done.outcome;
  const [job] = await query<Job>("SELECT * FROM jobs WHERE id=$1", [
    tick.jobId,
  ]);
  if (
    !job ||
    job.generation !== tick.generation ||
    job.sequence !== tick.sequence ||
    !["scanning", "copying"].includes(job.status)
  )
    return {
      more: false,
      generation: tick.generation,
      sequence: tick.sequence,
    };
  const drive = await Drive.forUser(job.user_id);
  const more =
    job.phase === "scan"
      ? await scanPage(job, drive)
      : await copyBatch(job, drive);
  const result = {
    more,
    generation: tick.generation,
    sequence: tick.sequence + 1,
  };
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO job_ticks(job_id,generation,sequence,outcome) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [job.id, tick.generation, tick.sequence, JSON.stringify(result)],
    );
    await client.query(
      "UPDATE jobs SET sequence=$2,updated_at=now(),error=null WHERE id=$1 AND generation=$3 AND sequence=$4",
      [job.id, result.sequence, tick.generation, tick.sequence],
    );
  });
  return result;
}
export async function failTick(tick: Tick, message?: string) {
  const reason =
    message &&
    /^(Google|Source|Destination|Two source|Drive|Multiple|Copy|The collision|An item)/.test(
      message,
    )
      ? message.slice(0, 300)
      : "Background processing exhausted its retries. Check Inngest logs, reconnect Google if needed, then resume.";
  await query(
    `UPDATE jobs SET status='failed',error=$3,updated_at=now()
    WHERE id=$1 AND generation=$2 AND status IN ('scanning','copying')`,
    [tick.jobId, tick.generation, reason],
  );
}
