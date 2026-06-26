import { createHash } from "node:crypto";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function verifySha256Integrity(text: string, expectedSha256: string): boolean {
  return sha256Text(text) === expectedSha256;
}

export function assertSha256Integrity(text: string, expectedSha256: string, label: string): void {
  if (!verifySha256Integrity(text, expectedSha256)) {
    throw new Error(`Integrity check failed for ${label}`);
  }
}
