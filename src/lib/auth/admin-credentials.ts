/**
 * Admin username/password + TOTP credentials (t80). Pure WebCrypto only —
 * no native deps, runs identically in Workers and in node tests.
 *
 * Passwords: PBKDF2-HMAC-SHA256, 100,000 iterations, 128-bit random salt,
 * 256-bit output, stored as
 *   pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
 * Verification recomputes and compares in constant time.
 *
 * Second factor: TOTP (RFC 6238, HMAC-SHA1, 30 s step, 6 digits, ±1 step
 * window — the code authenticator apps generate). The shared secret itself
 * must stay retrievable (unlike a password), so it is stored encrypted:
 * AES-GCM-256 with a key derived (SHA-256) from the desk session key
 * material (ADMIN_SESSION_SECRET + ADMIN_TOKEN). Consequence, documented in
 * ADMIN-GUIDE: rotating either secret invalidates sessions (as before) AND
 * makes the stored TOTP secret undecryptable — recovery codes (below) still
 * work then, and deleting the admin_users row restores token login.
 *
 * Recovery codes: 10 single-use codes, ~40 bits each from an unambiguous
 * alphabet, stored only as SHA-256 hashes; a successful use marks the row
 * used so it can never be replayed.
 */
import { constantTimeEqual } from "./session-token.ts";

const enc = new TextEncoder();
/**
 * 100,000 is the maximum PBKDF2 iteration count Cloudflare Workers'
 * WebCrypto accepts (t81: 600,000 threw "iteration counts above 100000 are
 * not supported" in production). It is the strongest setting the platform
 * allows; combined with a per-user 128-bit salt and this being a
 * single-admin login behind a 5/min rate limit, that is the right tradeoff
 * here. The count is embedded in every stored hash and verification reads
 * it back from the record, so raising this constant later upgrades new
 * hashes without invalidating old ones. Exported for the regression test
 * that pins it to the Workers cap.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/* ---------------- passwords ---------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterText, saltB64, hashB64] = stored.split("$");
    if (scheme !== "pbkdf2-sha256") return false;
    const iterations = Number(iterText);
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const salt = unb64(saltB64);
    const expected = unb64(hashB64);
    if (salt.length < 8 || expected.length !== 32) return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return constantTimeEqual(hex(new Uint8Array(bits)), hex(expected));
  } catch {
    return false;
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
export function validUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}
export function validPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/* ---------------- base32 (RFC 4648) ---------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

/* ---------------- TOTP (RFC 6238) ---------------- */

export function generateTotpSecret(): { secret: string; bytes: Uint8Array } {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return { secret: base32Encode(bytes), bytes };
}

export async function totpCode(secretBytes: Uint8Array, atSeconds: number, digits = 6): Promise<string> {
  const counter = Math.floor(atSeconds / 30);
  const msg = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i -= 1) { msg[i] = n & 0xff; n = Math.floor(n / 256); }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secretBytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Accepts the current step and one step either side (clock skew / typing time). */
export async function verifyTotp(secretBase32: string, code: string, atSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  let bytes: Uint8Array;
  try { bytes = base32Decode(secretBase32); } catch { return false; }
  for (const delta of [-30, 0, 30]) {
    if (constantTimeEqual(await totpCode(bytes, atSeconds + delta), clean)) return true;
  }
  return false;
}

export function otpauthUri(secretBase32: string, username: string): string {
  const label = encodeURIComponent(`DYPOL Blog:${username}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer: "DYPOL Blog", algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ---------------- TOTP secret encryption (AES-GCM) ---------------- */

async function encryptionKey(keyMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`dypol-totp-enc|${keyMaterial}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptTotpSecret(keyMaterial: string, secretBase32: string): Promise<string> {
  const key = await encryptionKey(keyMaterial);
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secretBase32)));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv); joined.set(ct, iv.length);
  return b64(joined);
}

/** Returns null when the secret can no longer be decrypted (key material rotated). */
export async function decryptTotpSecret(keyMaterial: string, stored: string): Promise<string | null> {
  try {
    const key = await encryptionKey(keyMaterial);
    const joined = unb64(stored);
    const iv = joined.slice(0, 12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, joined.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/* ---------------- recovery codes ---------------- */

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const raw = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(`recovery:${normalizeRecoveryCode(code)}`);
}
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalizeRecoveryCode(code));
}

/* ---------------- pending-2FA challenge cookie ---------------- */

export const CHALLENGE_TTL_SECONDS = 300; // 5 minutes to type the code

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message))));
}

export async function issueChallenge(key: string, userId: number, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `c1.${userId}.${now + CHALLENGE_TTL_SECONDS}.${nonce}`;
  return `${body}.${await hmacHex(`${key}|2fa-challenge`, body)}`;
}

export async function verifyChallenge(key: string, value: string, now = Math.floor(Date.now() / 1000)): Promise<{ ok: true; userId: number } | { ok: false }> {
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "c1") return { ok: false };
  const [, userText, expText, nonce, mac] = parts;
  if (!/^\d{1,9}$/.test(userText) || !/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) return { ok: false };
  const expected = await hmacHex(`${key}|2fa-challenge`, `c1.${userText}.${expText}.${nonce}`);
  if (!constantTimeEqual(mac, expected)) return { ok: false };
  if (Number(expText) <= now) return { ok: false };
  return { ok: true, userId: Number(userText) };
}
