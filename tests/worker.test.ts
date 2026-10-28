import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Drive, DriveError } from "../src/lib/drive";
import { processTick } from "../src/lib/worker";
import { FOLDER, type DriveFile, type JobConfig } from "../src/lib/types";
const config: JobConfig = {
  title: "Test",
  kind: "copy",
  sources: ["source"],
  destination: "destination",
  recursive: true,
  includeExtensions: [],
  excludeExtensions: [],
  nameIncludes: "",
  excludedFolders: [],
  layout: "preserve",
  conflicts: "skip",
  selection: [],
  matchBy: "filename",
  matchMode: "exact",
  batchSize: 400,
};
const file = (
  id: string,
  name: string,
  parent: string,
  mime = "application/octet-stream",
): DriveFile => ({
  id,
  name,
  parents: [parent],
  mimeType: mime,
  size: "10",
  md5Checksum: "checksum-" + id,
  modifiedTime: "2026-10-28T10:00:00Z",
});
class FakeDrive {
  files = new Map<string, DriveFile>();
  copies = 0;
  creates = 0;
  failAfterCopy = false;
  rateLimit = false;
  constructor() {
    this.files.set("source", {
      id: "source",
      name: "Source",
      mimeType: FOLDER,
    });
    this.files.set("destination", {
      id: "destination",
      name: "Destination",
      mimeType: FOLDER,
    });
  }
  async get(id: string) {
    const f = this.files.get(id);
    if (!f) throw new DriveError(404, false, "Missing file");
    return f;
  }
  async list(parent: string, token?: string) {
    const files = [...this.files.values()].filter((f) =>
      f.parents?.includes(parent),
    );
    return {
      files: files.slice(Number(token ?? 0), Number(token ?? 0) + 2),
      nextPageToken:
        files.length > Number(token ?? 0) + 2
          ? String(Number(token ?? 0) + 2)
          : undefined,
    };
  }
  async allMatching(parent: string, extra: string) {
    return [...this.files.values()].filter((f) => {
      if (!f.parents?.includes(parent)) return false;
      const name = extra.match(/^name='([^']*)'/)?.[1];
      if (name && f.name !== name) return false;
      const marker = extra.match(/value='([^']*)'/)?.[1];
      if (marker && f.appProperties?.toolkit_item !== marker) return false;
      return !extra.includes(`mimeType='${FOLDER}'`) || f.mimeType === FOLDER;
    });
  }
  async createFolder(name: string, parent: string, marker: string) {
    this.creates++;
    const f = {
      id: randomUUID(),
      name,
      parents: [parent],
      mimeType: FOLDER,
      appProperties: { toolkit_folder: marker },
    };
    this.files.set(f.id, f);
    return f;
  }
  async copy(id: string, name: string, parent: string, marker: string) {
    if (this.rateLimit) throw new DriveError(429, true, "Rate limited");
    const source = await this.get(id);
    this.copies++;
    const f = {
      ...source,
      id: randomUUID(),
      name,
      parents: [parent],
      appProperties: { toolkit_item: marker },
    };
    this.files.set(f.id, f);
    if (this.failAfterCopy) {
      this.failAfterCopy = false;
      throw new TypeError("Lost response after Google committed the copy");
    }
    return f;
  }
}
test("durable worker against PostgreSQL: scans, ambiguity, resume, safe retries and metadata", async (t) => {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL("../scripts/schema.sql", import.meta.url), "utf8"),
  );
  const adapter = {
    query: async (sql: string, params: unknown[] = []) =>
      db.query<Record<string, unknown>>(sql, params),
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) =>
        db.query<Record<string, unknown>>(sql, params),
      release() {},
    }),
  };
  (globalThis as unknown as { toolkitPool: unknown }).toolkitPool = adapter;
  await db.query<Record<string, unknown>>(
    "INSERT INTO users(id,email,name,refresh_token) VALUES('user','test@example.com','Test','encrypted')",
  );
  let fake = new FakeDrive();
  const original = Drive.forUser;
  Drive.forUser = async () => fake as unknown as Drive;
  async function make(overrides: Partial<JobConfig> = {}) {
    const id = randomUUID(),
      c = { ...config, ...overrides };
    await db.query<Record<string, unknown>>(
      "INSERT INTO jobs(id,user_id,title,kind,config) VALUES($1,$2,$3,$4,$5)",
      [id, "user", "Test", c.kind, JSON.stringify(c)],
    );
    await db.query<Record<string, unknown>>(
      "INSERT INTO scan_queue(job_id,folder_id,relative_path) VALUES($1,'source','')",
      [id],
    );
    await db.query<Record<string, unknown>>(
      "INSERT INTO destination_folders(job_id,path,folder_id) VALUES($1,'','destination')",
      [id],
    );
    return id;
  }
  async function run(id: string) {
    for (let i = 0; i < 100; i++) {
      const {
        rows: [j],
      } = await db.query<{
        generation: number;
        sequence: number;
        status: string;
      }>("SELECT * FROM jobs WHERE id=$1", [id]);
      if (!["scanning", "copying"].includes(j.status)) return;
      await processTick({
        jobId: id,
        generation: j.generation,
        sequence: j.sequence,
      });
    }
    throw new Error("Worker did not finish");
  }
  async function start(id: string) {
    await db.query<Record<string, unknown>>(
      "UPDATE jobs SET status='copying',phase='copy',generation=generation+1,sequence=0 WHERE id=$1",
      [id],
    );
  }
  try {
    await t.test(
      "recursive mixed-format scans, pages, empty folders, preview then copy",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.JSON", "source"));
        fake.files.set("b", file("b", "b.ZIP", "source"));
        fake.files.set("nested", {
          id: "nested",
          name: "nested",
          mimeType: FOLDER,
          parents: ["source"],
        });
        fake.files.set("empty", {
          id: "empty",
          name: "empty",
          mimeType: FOLDER,
          parents: ["source"],
        });
        fake.files.set("c", file("c", "c.JPG", "nested", "image/jpeg"));
        const id = await make();
        await run(id);
        assert.equal(fake.copies, 0);
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT * FROM items WHERE job_id=$1",
          [id],
        );
        assert.equal(rows.length, 3);
        await start(id);
        await run(id);
        assert.equal(fake.copies, 3);
        assert.ok(
          [...fake.files.values()].some(
            (f) => f.name === "empty" && f.parents?.includes("destination"),
          ),
        );
      },
    );
    await t.test(
      "nonrecursive extension selection excludes nested content",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.JSON", "source"));
        fake.files.set("b", file("b", "b.zip", "source"));
        fake.files.set("nested", {
          id: "nested",
          name: "nested",
          mimeType: FOLDER,
          parents: ["source"],
        });
        fake.files.set("c", file("c", "c.json", "nested"));
        const id = await make({
          recursive: false,
          includeExtensions: ["json"],
        });
        await run(id);
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT name FROM items WHERE job_id=$1",
          [id],
        );
        assert.deepEqual(
          rows.map((r) => r.name),
          ["a.JSON"],
        );
      },
    );
    await t.test(
      "ambiguous filename matches are excluded, missing rows remain visible",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "same.JPG", "source"));
        fake.files.set("b", file("b", "same.JPG", "source"));
        const id = await make({
          selection: [
            { value: "same.jpg", structure: "", batch: "" },
            { value: "missing.jpg", structure: "", batch: "" },
          ],
        });
        await run(id);
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT status FROM items WHERE job_id=$1",
          [id],
        );
        assert.deepEqual(
          rows.map((r) => r.status),
          ["ambiguous", "ambiguous"],
        );
        const { rows: counts } = await db.query<Record<string, unknown>>(
          "SELECT DISTINCT row_index FROM selection_matches WHERE job_id=$1",
          [id],
        );
        assert.equal(counts.length, 1);
      },
    );
    await t.test(
      "folder list includes all descendants and maps structure destination",
      async () => {
        fake = new FakeDrive();
        fake.files.set("pole", {
          id: "pole",
          name: "1001",
          mimeType: FOLDER,
          parents: ["source"],
        });
        fake.files.set("sub", {
          id: "sub",
          name: "sub",
          mimeType: FOLDER,
          parents: ["pole"],
        });
        fake.files.set("a", file("a", "a.json", "pole"));
        fake.files.set("b", file("b", "b.zip", "sub"));
        fake.files.set("other", file("other", "other.jpg", "source"));
        const id = await make({
          matchBy: "folder",
          layout: "structure",
          selection: [{ value: "1001", structure: "1001", batch: "" }],
        });
        await run(id);
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT target_path,status FROM items WHERE job_id=$1",
          [id],
        );
        assert.equal(rows.length, 2);
        assert.ok(
          rows.every((r) => r.target_path === "1001" && r.status === "pending"),
        );
      },
    );
    await t.test(
      "uncertain copy reconciles its marker without creating a duplicate",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.zip", "source"));
        const id = await make({ layout: "flat" });
        await run(id);
        await start(id);
        fake.failAfterCopy = true;
        await assert.rejects(
          () => processTick({ jobId: id, generation: 2, sequence: 0 }),
          /Lost response/,
        );
        assert.equal(fake.copies, 1);
        await run(id);
        assert.equal(fake.copies, 1);
        const {
          rows: [item],
        } = await db.query<Record<string, unknown>>(
          "SELECT status FROM items WHERE job_id=$1",
          [id],
        );
        assert.equal(item.status, "copied");
        await processTick({ jobId: id, generation: 2, sequence: 0 });
        assert.equal(fake.copies, 1);
      },
    );
    await t.test(
      "paused generations reject stale events; rate limits retain pending state",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.zip", "source"));
        const id = await make();
        await run(id);
        await start(id);
        await db.query<Record<string, unknown>>(
          "UPDATE jobs SET status='paused',generation=3,sequence=0 WHERE id=$1",
          [id],
        );
        await processTick({ jobId: id, generation: 2, sequence: 0 });
        assert.equal(fake.copies, 0);
        await db.query<Record<string, unknown>>(
          "UPDATE jobs SET status='copying',generation=4 WHERE id=$1",
          [id],
        );
        fake.rateLimit = true;
        await assert.rejects(
          () => processTick({ jobId: id, generation: 4, sequence: 0 }),
          /Rate limited/,
        );
        const {
          rows: [item],
        } = await db.query<Record<string, unknown>>(
          "SELECT status FROM items WHERE job_id=$1",
          [id],
        );
        assert.equal(item.status, "pending");
        fake.rateLimit = false;
        await run(id);
        assert.equal(fake.copies, 1);
      },
    );
    await t.test(
      "existing file is skipped, changed source is reported, metadata is read-only",
      async () => {
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.json", "source"));
        fake.files.set("existing", file("existing", "a.json", "destination"));
        const id = await make({ layout: "flat" });
        await run(id);
        await start(id);
        await run(id);
        assert.equal(fake.copies, 0);
        const {
          rows: [item],
        } = await db.query<Record<string, unknown>>(
          "SELECT status FROM items WHERE job_id=$1",
          [id],
        );
        assert.equal(item.status, "skipped");
        fake = new FakeDrive();
        fake.files.set("a", file("a", "a.json", "source"));
        const changed = await make();
        await run(changed);
        fake.files.set("a", {
          ...fake.files.get("a")!,
          md5Checksum: "new-revision",
        });
        await start(changed);
        await run(changed);
        const {
          rows: [bad],
        } = await db.query<Record<string, unknown>>(
          "SELECT status,error FROM items WHERE job_id=$1",
          [changed],
        );
        assert.equal(bad.status, "error");
        assert.match(String(bad.error), /changed/);
        fake = new FakeDrive();
        fake.files.set("photo", {
          ...file("photo", "a.JPG", "source", "image/jpeg"),
          imageMediaMetadata: {
            width: 1200,
            height: 800,
            location: { latitude: 1, longitude: 2 },
          },
        });
        const metadata = await make({ kind: "metadata" });
        await run(metadata);
        const {
          rows: [j],
        } = await db.query<Record<string, unknown>>(
          "SELECT status FROM jobs WHERE id=$1",
          [metadata],
        );
        assert.equal(j.status, "completed");
        assert.equal(fake.copies, 0);
      },
    );
  } finally {
    Drive.forUser = original;
    delete (globalThis as unknown as { toolkitPool?: unknown }).toolkitPool;
    await db.close();
  }
});
