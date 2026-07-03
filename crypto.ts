import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.SESSION_SECRET ?? "default-dev-key-32-chars-padding!!";
  return Buffer.from(key.padEnd(32, "0").slice(0, 32));
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !encrypted) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function signHmacSha256(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}
