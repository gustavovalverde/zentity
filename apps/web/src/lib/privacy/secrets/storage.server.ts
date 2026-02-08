import "server-only";

/**
 * Server-Side Secret Blob Storage
 *
 * File-based storage for encrypted secret blobs.
 * Uses SHA-256 hash of secretId as the filename.
 */

import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_BLOB_DIR = ".data/secret-blobs";
const DEFAULT_SECRET_BLOB_MAX_BYTES = 90 * 1024 * 1024; // 90 MiB
const BLOB_REF_PATTERN = /^[a-f0-9]{64}$/;

function getBlobDir(): string {
  return process.env.SECRET_BLOB_DIR || join(process.cwd(), DEFAULT_BLOB_DIR);
}

export function computeSecretBlobRef(secretId: string): string {
  return createHash("sha256").update(secretId).digest("hex");
}

export function isValidSecretBlobRef(blobRef: string): boolean {
  return BLOB_REF_PATTERN.test(blobRef.trim().toLowerCase());
}

export function getSecretBlobMaxBytes(): number {
  const fromEnv = process.env.SECRET_BLOB_MAX_BYTES?.trim();
  if (!fromEnv) {
    return DEFAULT_SECRET_BLOB_MAX_BYTES;
  }
  const parsed = Number.parseInt(fromEnv, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SECRET_BLOB_MAX_BYTES;
  }
  return parsed;
}

export class SecretBlobTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`Secret blob exceeds max size of ${maxBytes} bytes.`);
    this.name = "SecretBlobTooLargeError";
    this.maxBytes = maxBytes;
  }
}

async function ensureBlobDir(): Promise<string> {
  const dir = getBlobDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function resolveBlobPath(dir: string, blobRef: string): string {
  const normalized = blobRef.trim().toLowerCase();
  if (!isValidSecretBlobRef(normalized)) {
    throw new Error("Invalid secret blob reference.");
  }
  return join(dir, `${normalized}.bin`);
}

/**
 * Write an encrypted blob to the file system.
 *
 * @returns Blob reference (hash of secretId), content hash, and size
 */
export async function writeSecretBlob(params: {
  secretId: string;
  body: ReadableStream<Uint8Array>;
}): Promise<{ blobRef: string; blobHash: string; blobSize: number }> {
  const dir = await ensureBlobDir();
  const blobRef = computeSecretBlobRef(params.secretId);
  const filePath = resolveBlobPath(dir, blobRef);
  const tmpPath = join(dir, `${blobRef}.tmp-${randomUUID()}`);

  const hash = createHash("sha256");
  let size = 0;
  const maxBytes = getSecretBlobMaxBytes();

  const readable = Readable.fromWeb(
    params.body as unknown as NodeReadableStream
  );
  const writable = createWriteStream(tmpPath);

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > maxBytes) {
        callback(new SecretBlobTooLargeError(maxBytes));
        return;
      }
      hash.update(bytes);
      callback(null, bytes);
    },
  });

  try {
    await pipeline(readable, meter, writable);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }

  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    // On some platforms rename fails if destination exists; retry after unlink.
    await unlink(filePath).catch(() => undefined);
    try {
      await rename(tmpPath, filePath);
    } catch (renameError) {
      await unlink(tmpPath).catch(() => undefined);
      throw renameError instanceof Error ? renameError : error;
    }
  }

  return {
    blobRef,
    blobHash: hash.digest("hex"),
    blobSize: size,
  };
}

/**
 * Read an encrypted blob from the file system.
 *
 * @returns The blob as a ReadableStream, or null if not found
 */
export async function readSecretBlob(params: {
  blobRef: string;
}): Promise<ReadableStream<Uint8Array> | null> {
  const dir = await ensureBlobDir();
  if (!isValidSecretBlobRef(params.blobRef)) {
    return null;
  }

  const filePath = resolveBlobPath(dir, params.blobRef);
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return null;
  }
  const stream = createReadStream(filePath);
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
