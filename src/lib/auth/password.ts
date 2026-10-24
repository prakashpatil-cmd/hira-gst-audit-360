import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const got = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Password policy: ≥ 10 characters with upper, lower, digit and symbol. */
export function passwordPolicyErrors(pw: string): string[] {
  const e: string[] = [];
  if (pw.length < 10) e.push("at least 10 characters");
  if (!/[A-Z]/.test(pw)) e.push("an upper-case letter");
  if (!/[a-z]/.test(pw)) e.push("a lower-case letter");
  if (!/\d/.test(pw)) e.push("a digit");
  if (!/[^A-Za-z0-9]/.test(pw)) e.push("a symbol");
  return e;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) for MFA -------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) { const i = B32.indexOf(c); if (i < 0) throw new Error("bad base32"); value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, timeMs = Date.now(), step = 30): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

export function verifyTotp(secret: string, code: string, timeMs = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const drift of [-1, 0, 1]) {
    const expected = totpCode(secret, timeMs + drift * 30_000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}
