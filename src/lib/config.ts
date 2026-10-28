export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See deployment instructions.`);
  return value;
}
export function origin() {
  return new URL(env("APP_URL")).origin;
}
export function setupStatus() {
  return [
    "APP_URL",
    "ALLOWED_EMAILS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "DATABASE_URL",
    ...(process.env.INNGEST_DEV === "1"
      ? []
      : ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]),
  ].filter((key) => !process.env[key]);
}

export function allowedEmail(email: string) {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
