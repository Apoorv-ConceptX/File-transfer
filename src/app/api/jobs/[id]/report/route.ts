import { NextRequest, NextResponse } from "next/server";
import { requireUser, failure, HttpError } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { query } from "@/lib/db";
import type { Item } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(),
      { id } = await ctx.params;
    if (!/^[\da-f-]{36}$/i.test(id)) throw new HttpError(404, "Job not found");
    const job = await getJob(id, user.id);
    if (!job) throw new HttpError(404, "Job not found");
    const offset = Math.max(
      0,
      Math.min(10000000, Number(req.nextUrl.searchParams.get("offset")) || 0),
    );
    if (req.nextUrl.searchParams.get("type") === "selection") {
      const counts = await query<{ row_index: number; count: number }>(
        "SELECT row_index,count(*)::int count FROM selection_matches WHERE job_id=$1 GROUP BY row_index",
        [id],
      );
      const map = new Map(counts.map((r) => [r.row_index, r.count]));
      const rows = job.config.selection
        .slice(offset, offset + 200)
        .map((r, i) => ({
          row: offset + i + 1,
          ...r,
          matches: map.get(offset + i) ?? 0,
          result: !map.has(offset + i)
            ? "missing"
            : !["equipment", "folder"].includes(job.config.matchBy) &&
                map.get(offset + i)! > 1
              ? "ambiguous"
              : "matched",
        }));
      return NextResponse.json({
        rows,
        next: offset + 200 < job.config.selection.length ? offset + 200 : null,
      });
    }
    const items = await query<Item>(
      "SELECT * FROM items WHERE job_id=$1 ORDER BY id OFFSET $2 LIMIT 201",
      [id, offset],
    );
    const rows = items.slice(0, 200).map((item) => {
      const image = item.metadata.imageMediaMetadata ?? {};
      const location = image.location as Record<string, unknown> | undefined;
      return {
        source_id: item.source_id,
        filename: item.name,
        source_folder: item.relative_path,
        destination_folder: item.target_path,
        mime_type: item.mime_type,
        bytes: item.bytes,
        checksum: item.checksum,
        modified_time: item.metadata.modifiedTime ?? "",
        status: item.status,
        error: item.error ?? "",
        destination_id: item.destination_id ?? "",
        width: image.width ?? "",
        height: image.height ?? "",
        captured_time: image.time ?? "",
        camera_make: image.cameraMake ?? "",
        camera_model: image.cameraModel ?? "",
        latitude: location?.latitude ?? "",
        longitude: location?.longitude ?? "",
        altitude: location?.altitude ?? "",
        image_metadata: image,
        drive_link:
          item.metadata.webViewLink ??
          `https://drive.google.com/file/d/${item.source_id}/view`,
      };
    });
    return NextResponse.json({
      rows,
      next: items.length > 200 ? offset + 200 : null,
    });
  } catch (e) {
    return failure(e);
  }
}
