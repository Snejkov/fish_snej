import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function validPassword(password) {
  return typeof password === "string" && Buffer.byteLength(password) >= 12 && Buffer.byteLength(password) <= 256;
}
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("Password must contain 12 to 256 bytes.");
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, OPTIONS);
  return `scrypt.v1.32768.8.3.${salt}.${key.toString("hex")}`;
}
export async function verifyPassword(password, record) {
  if (!validPassword(password)) return false;
  const parts = String(record).split(".");
  if (parts.length !== 7 || parts.slice(0, 5).join(".") !== "scrypt.v1.32768.8.3"
    || !/^[a-f0-9]{32}$/.test(parts[5]) || !/^[a-f0-9]{128}$/.test(parts[6])) return false;
  const key = await derive(password, parts[5], 64, OPTIONS);
  return timingSafeEqual(key, Buffer.from(parts[6], "hex"));
}
export function readSession(cookie) {
  const matches = String(cookie || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("snej_session="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(13);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function sessionCookie(token, secure, clear = false) {
  return `snej_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
