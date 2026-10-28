import { NextRequest, NextResponse } from "next/server";
import { requireUser, sameOrigin, failure, HttpError } from "@/lib/auth";
import { query } from "@/lib/db";
import { jobSchema } from "@/lib/rules";
import { createJob, statsSql } from "@/lib/jobs";
import { inngest, eventFor } from "@/lib/inngest";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  try {
    const user = await requireUser();
    const jobs = await query(
      `${statsSql} WHERE j.user_id=$1 ORDER BY j.created_at DESC LIMIT 100`,
      [user.id],
    );
    return NextResponse.json({
      jobs: jobs.map((j) => ({ ...j, config: undefined })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const text = await req.text();
    if (Buffer.byteLength(text) > 3_000_000)
      throw new HttpError(
        413,
        "Selection is too large. Split it into smaller lists.",
      );
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "Invalid request");
    }
    const parsed = jobSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    let job;
    try {
      job = await createJob(user.id, parsed.data);
    } catch (e) {
      // Only known validation / Drive messages are suitable for the browser.
      const msg = e instanceof Error ? e.message : "";
      if (
        /destination|Destination|Drive|Google|source|Source|shortcut|link|ID|folder|bin|ancestry/i.test(
          msg,
        ) &&
        !/password|postgres|connect ECONN|DATABASE/i.test(msg)
      )
        throw new HttpError(400, msg);
      throw e;
    }
    let dispatchError = false;
    try {
      await inngest.send(
        eventFor({
          jobId: job.id,
          generation: job.generation,
          sequence: job.sequence,
        }),
      );
    } catch {
      dispatchError = true;
      await query(
        "UPDATE jobs SET status='failed',error='Could not queue the job. Check Inngest configuration and resume.' WHERE id=$1 AND generation=1 AND sequence=0",
        [job.id],
      );
    }
    return NextResponse.json({ job, dispatchError }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
