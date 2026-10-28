import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { query } from "./db";
import { hash } from "./crypto";
import { origin, allowedEmail } from "./config";
export type User = { id: string; email: string; name: string };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const allowed = allowedEmail;
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("toolkit_session")?.value;
  if (!token) return null;
  const [user] = await query<User>(
    `SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON s.user_id=u.id
    WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hash(token)],
  );
  return user && allowed(user.email) ? user : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in to continue");
  return user;
}
export function sameOrigin(req: NextRequest) {
  if (req.headers.get("origin") !== origin())
    throw new HttpError(403, "Request origin does not match APP_URL");
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  // Never expose DB connection strings, OAuth responses, or stack traces.
  console.error(
    "[toolkit]",
    error instanceof Error ? error.name : "Unknown error",
  );
  return NextResponse.json(
    {
      error:
        "The request could not be completed. Check deployment settings and server logs.",
    },
    { status: 500 },
  );
}
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: origin().startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
