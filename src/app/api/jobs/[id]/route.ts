import { NextRequest, NextResponse } from "next/server";
import { requireUser, sameOrigin, failure, HttpError } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { query, transaction } from "@/lib/db";
import { inngest, eventFor } from "@/lib/inngest";
import type { Job } from "@/lib/types";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const user = await requireUser(),
      { id } = await ctx.params;
    if (!/^[\da-f-]{36}$/i.test(id)) throw new HttpError(404, "Job not found");
    const job = await getJob(id, user.id);
    if (!job) throw new HttpError(404, "Job not found");
    const items = await query(
      "SELECT id,name,relative_path,target_path,status,error,bytes FROM items WHERE job_id=$1 ORDER BY name,id LIMIT 100",
      [id],
    );
    const [scan] = await query(
      "SELECT count(*)::int folders,count(*) FILTER(WHERE done)::int scanned FROM scan_queue WHERE job_id=$1",
      [id],
    );
    const counts = await query<{ row_index: number; count: number }>(
      "SELECT row_index,count(*)::int count FROM selection_matches WHERE job_id=$1 GROUP BY row_index",
      [id],
    );
    const missing = job.config.selection.length - counts.length;
    return NextResponse.json({ job, items, scan, missing });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    sameOrigin(req);
    const user = await requireUser(),
      { id } = await ctx.params;
    if (!/^[\da-f-]{36}$/i.test(id)) throw new HttpError(404, "Job not found");
    const { action } = await req.json();
    if (!["start", "pause", "resume", "cancel", "retry"].includes(action))
      throw new HttpError(400, "Unknown action");
    const job = await transaction(async (client) => {
      const { rows } = await client.query<Job>(
        "SELECT * FROM jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, user.id],
      );
      const j = rows[0];
      if (!j) throw new HttpError(404, "Job not found");
      if (action === "start" && j.status !== "ready")
        throw new HttpError(409, "Scan must finish before copying");
      if (action === "pause" && !["scanning", "copying"].includes(j.status))
        throw new HttpError(409, "Job is not running");
      if (
        action === "resume" &&
        !["paused", "failed", "scanning", "copying"].includes(j.status)
      )
        throw new HttpError(409, "This job cannot be resumed");
      if (action === "retry" && j.status !== "completed")
        throw new HttpError(
          409,
          "Wait for the job to finish before retrying errors",
        );
      if (action === "cancel" && ["completed", "cancelled"].includes(j.status))
        throw new HttpError(409, "Job has already finished");
      const phase = action === "start" || action === "retry" ? "copy" : j.phase;
      const status =
        action === "pause"
          ? "paused"
          : action === "cancel"
            ? "cancelled"
            : phase === "scan"
              ? "scanning"
              : "copying";
      if (action === "retry")
        await client.query(
          "UPDATE items SET status='pending',error=null WHERE job_id=$1 AND status='error'",
          [id],
        );
      const updated = await client.query<Job>(
        `UPDATE jobs SET status=$2,phase=$3,generation=generation+1,sequence=0,error=null,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, status, phase],
      );
      return updated.rows[0];
    });
    if (!["pause", "cancel"].includes(action)) {
      try {
        await inngest.send(
          eventFor({ jobId: job.id, generation: job.generation, sequence: 0 }),
        );
      } catch {
        await query(
          "UPDATE jobs SET status='failed',error='Could not queue the job. Check Inngest configuration and resume.' WHERE id=$1 AND generation=$2 AND sequence=0",
          [id, job.generation],
        );
        throw new HttpError(
          503,
          "Progress is saved, but queuing failed. Check Inngest and resume.",
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
