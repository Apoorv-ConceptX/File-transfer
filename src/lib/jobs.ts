import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import type { Job, JobConfig, DriveFile } from "./types";
import { FOLDER } from "./types";
import { Drive } from "./drive";
import { driveId, safeSegment } from "./rules";
export const statsSql = `SELECT j.*,
 (SELECT count(*)::int FROM items WHERE job_id=j.id) total,
 (SELECT count(*)::int FROM items WHERE job_id=j.id AND status='copied') copied,
 (SELECT count(*)::int FROM items WHERE job_id=j.id AND status='skipped') skipped,
 (SELECT count(*)::int FROM items WHERE job_id=j.id AND status='error') errors,
 (SELECT count(*)::int FROM items WHERE job_id=j.id AND status='ambiguous') ambiguous,
 (SELECT count(*)::int FROM items WHERE job_id=j.id AND status='pending') pending
 FROM jobs j`;
export async function getJob(id: string, userId?: string) {
  const [job] = await query<Job>(
    `${statsSql} WHERE j.id=$1 ${userId ? "AND j.user_id=$2" : ""}`,
    userId ? [id, userId] : [id],
  );
  return job;
}
export async function createJob(userId: string, config: JobConfig) {
  const drive = await Drive.forUser(userId);
  const sources: DriveFile[] = [];
  for (const input of config.sources) {
    const file = await drive.resolve(driveId(input));
    if (!sources.some((f) => f.id === file.id)) sources.push(file);
  }
  if (config.kind === "copy") {
    const destination = await drive.resolve(driveId(config.destination));
    await drive.ensureSafeDestination(sources, destination);
    config.destination = destination.id;
  }
  config.sources = sources.map((f) => f.id);
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO jobs(id,user_id,title,kind,config) VALUES($1,$2,$3,$4,$5)",
      [id, userId, config.title, config.kind, JSON.stringify(config)],
    );
    // Direct file sources are represented by a queue entry too, then handled by the scanner.
    for (const file of sources)
      await client.query(
        `INSERT INTO scan_queue(job_id,folder_id,relative_path) VALUES($1,$2,$3)`,
        [
          id,
          file.id,
          sources.length > 1 ? `${safeSegment(file.name)}__${file.id}` : "",
        ],
      );
    if (config.kind === "copy")
      await client.query(
        "INSERT INTO destination_folders(job_id,path,folder_id) VALUES($1,$2,$3)",
        [id, "", config.destination],
      );
  });
  return (await getJob(id))!;
}
