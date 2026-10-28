import { NextResponse } from "next/server";
import { currentUser, failure } from "@/lib/auth";
import { setupStatus } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const missing = setupStatus();
    return NextResponse.json({
      user: missing.length ? null : await currentUser(),
      missing,
    });
  } catch (e) {
    return failure(e);
  }
}
