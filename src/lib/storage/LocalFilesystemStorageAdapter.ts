import fs from "node:fs";
import path from "node:path";
import type { StorageAdapter } from "./StorageAdapter";

/**
 * The only StorageAdapter implementation this phase — local disk, matching
 * this project's Postgres-started-local-first precedent. Bytes are never
 * encrypted at rest and never exposed via a public/static path; they only
 * ever flow through an authenticated download Route Handler that rechecks
 * authorization on every request (see src/lib/documents/scoping.ts).
 *
 * `rootDir` is passed explicitly, not read from an env var inside the class,
 * so tests can point this at a scratch temp directory without mutating
 * process.env.
 */
export class LocalFilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    return path.join(this.rootDir, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data);
  }

  createReadStream(key: string): NodeJS.ReadableStream {
    return fs.createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolve(key));
  }
}

/** Isolates storage by Provider and Case on disk (spec §26). */
export function computeStorageKey(providerId: string, caseId: string, sourceFileId: string): string {
  return `${providerId}/${caseId}/${sourceFileId}`;
}
