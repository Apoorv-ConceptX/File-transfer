import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, cookieOptions, failure } from "@/lib/auth";
import { query } from "@/lib/db";
import { hash } from "@/lib/crypto";
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const token = req.cookies.get("toolkit_session")?.value;
    if (token)
      await query("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]);
    const res = NextResponse.json({ ok: true });
    res.cookies.set("toolkit_session", "", cookieOptions(0));
    return res;
  } catch (e) {
    return failure(e);
  }
}
