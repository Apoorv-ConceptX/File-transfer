import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env, origin } from "@/lib/config";
import { query } from "@/lib/db";
import { encrypt, hash, random } from "@/lib/crypto";
import { allowed, cookieOptions } from "@/lib/auth";
export async function GET(req: NextRequest) {
  try {
    const oauth = JSON.parse(req.cookies.get("toolkit_oauth")?.value ?? "{}");
    const state = req.nextUrl.searchParams.get("state") ?? "";
    if (
      !oauth.state ||
      Buffer.byteLength(state) !== Buffer.byteLength(oauth.state) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(oauth.state))
    )
      throw new Error("state");
    const code = req.nextUrl.searchParams.get("code");
    if (!code) throw new Error("denied");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: `${origin()}/api/auth/callback`,
        grant_type: "authorization_code",
        code_verifier: oauth.verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("exchange");
    const tokens = await response.json();
    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!profileResponse.ok) throw new Error("profile");
    const profile = await profileResponse.json();
    if (!profile.email_verified || !allowed(profile.email))
      throw new Error("allowlist");
    // Require the full scope: drive.file cannot enumerate arbitrary existing shared folders.
    if (
      !String(tokens.scope)
        .split(" ")
        .includes("https://www.googleapis.com/auth/drive")
    )
      throw new Error("scope");
    const [existing] = await query(
      "SELECT refresh_token FROM users WHERE id=$1",
      [profile.sub],
    );
    const refresh = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existing?.refresh_token;
    if (!refresh) throw new Error("offline");
    await query(
      `INSERT INTO users(id,email,name,refresh_token) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET email=$2,name=$3,refresh_token=$4`,
      [profile.sub, profile.email, profile.name ?? profile.email, refresh],
    );
    const session = random();
    await query("DELETE FROM sessions WHERE expires_at<now()");
    await query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [hash(session), profile.sub],
    );
    const res = NextResponse.redirect(origin());
    res.cookies.set("toolkit_session", session, cookieOptions(30 * 86400));
    res.cookies.set("toolkit_oauth", "", cookieOptions(0));
    return res;
  } catch (e) {
    const reason =
      e instanceof Error &&
      ["allowlist", "scope", "offline", "state", "denied"].includes(e.message)
        ? e.message
        : "connection";
    const res = NextResponse.redirect(`${origin()}/?authError=${reason}`);
    res.cookies.set("toolkit_oauth", "", cookieOptions(0));
    return res;
  }
}
