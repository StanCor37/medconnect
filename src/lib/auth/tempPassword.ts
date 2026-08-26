import { randomBytes } from "crypto";

const TEMP_PASSWORD_TTL_HOURS = 72;

/** Human-typeable temp password: 16 chars from an unambiguous alphabet. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generateTempPassword(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function tempPasswordExpiresAt(): Date {
  return new Date(Date.now() + TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000);
}
