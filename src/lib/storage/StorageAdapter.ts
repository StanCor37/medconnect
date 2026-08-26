/**
 * Pluggable storage boundary for immutable Document originals. Service
 * functions take an instance of this explicitly (like `tx`), never importing
 * a singleton internally — this is what lets tests point at a scratch
 * directory and lets a future cloud backend swap in without touching the
 * service layer.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  createReadStream(key: string): NodeJS.ReadableStream;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
