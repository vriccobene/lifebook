import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/*
 * Secrets Lifebook must use again (the Firefly III token) cannot be hashed like its own tokens: they are
 * encrypted with AES-256-GCM. The key lives outside the database, so neither the database nor its backups
 * contain a usable secret.
 */

const KEY_BYTES = 32;

function parseKey(text: string, origin: string): Buffer {
  const key = Buffer.from(text.trim(), "base64");
  if (key.length !== KEY_BYTES) throw new Error(`${origin}: expected ${KEY_BYTES} bytes in base64`);
  return key;
}

/**
 * The key from `LIFEBOOK_SECRET_KEY` (base64) if set, otherwise from `file`, which is created (mode 600) on
 * the first start. Losing the key only means entering the Firefly III token again.
 */
export function loadSecretKey(file: string, env = process.env.LIFEBOOK_SECRET_KEY): Buffer {
  if (env) return parseKey(env, "LIFEBOOK_SECRET_KEY");
  if (existsSync(file)) return parseKey(readFileSync(file, "utf8"), file);
  const key = randomBytes(KEY_BYTES);
  writeFileSync(file, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
  return key;
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64. */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", ...[iv, cipher.getAuthTag(), data].map((p) => p.toString("base64"))].join(":");
}

/** Returns null when the value was encrypted with another key (or tampered with). */
export function decryptSecret(key: Buffer, stored: string): string | null {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
