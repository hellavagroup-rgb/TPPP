import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENC_PREFIX = "enc:";

function getKey(): Buffer {
  const raw = process.env.STRIPE_ENCRYPTION_KEY;
  if (!raw) throw new Error("STRIPE_ENCRYPTION_KEY env var is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "STRIPE_ENCRYPTION_KEY must be a 32-byte value encoded as base64"
    );
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) {
    // Legacy plaintext value — return as-is so existing data still works
    return ciphertext;
  }
  const key = getKey();
  const data = Buffer.from(ciphertext.slice(ENC_PREFIX.length), "base64");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const encrypted = data.subarray(IV_BYTES, data.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env.STRIPE_ENCRYPTION_KEY;
  if (!raw) return false;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32;
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
