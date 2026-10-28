import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { env } from "./config";
function key() {
  const value = Buffer.from(env("TOKEN_ENCRYPTION_KEY"), "base64");
  if (value.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return value;
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const random = () => randomBytes(32).toString("base64url");
