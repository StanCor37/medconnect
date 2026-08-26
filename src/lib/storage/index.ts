import path from "node:path";
import { LocalFilesystemStorageAdapter } from "./LocalFilesystemStorageAdapter";
import type { StorageAdapter } from "./StorageAdapter";

export type { StorageAdapter } from "./StorageAdapter";
export { LocalFilesystemStorageAdapter, computeStorageKey } from "./LocalFilesystemStorageAdapter";

let singleton: StorageAdapter | null = null;

/** The default adapter API routes use — a singleton rooted at DOCUMENT_STORAGE_ROOT (or ./storage/documents). */
export function getDefaultStorageAdapter(): StorageAdapter {
  if (!singleton) {
    const rootDir = process.env.DOCUMENT_STORAGE_ROOT ?? path.join(process.cwd(), "storage", "documents");
    singleton = new LocalFilesystemStorageAdapter(rootDir);
  }
  return singleton;
}
