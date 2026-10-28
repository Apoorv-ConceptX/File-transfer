import { NextResponse } from "next/server";
import { env, origin, setupStatus } from "@/lib/config";
import { cookieOptions, failure } from "@/lib/auth";
import { random, hash } from "@/lib/crypto";
export async function GET() {
  try {
    if (setupStatus().length)
      return NextResponse.redirect(`${origin()}/?authError=setup`);
    const state = random(),
      verifier = random();
    const challenge = Buffer.from(hash(verifier), "hex").toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: `${origin()}/api/auth/callback`,
      response_type: "code",
      scope: "openid email profile https://www.googleapis.com/auth/drive",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    const res = NextResponse.redirect(url);
    res.cookies.set(
      "toolkit_oauth",
      JSON.stringify({ state, verifier }),
      cookieOptions(600),
    );
    return res;
  } catch (e) {
    return failure(e);
  }
}
