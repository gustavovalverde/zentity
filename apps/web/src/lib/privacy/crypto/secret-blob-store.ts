import "server-only";

import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

const DEFAULT_BLOB_DIR = ".data/secret-blobs";

function getBlobDir(): string {
  return process.env.SECRET_BLOB_DIR || join(process.cwd(), DEFAULT_BLOB_DIR);
}

function getBlobRef(secretId: string): string {
  return createHash("sha256").update(secretId).digest("hex");
}

async function ensureBlobDir(): Promise<string> {
  const dir = getBlobDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeSecretBlob(params: {
  secretId: string;
  body: ReadableStream<Uint8Array>;
}): Promise<{ blobRef: string; blobHash: string; blobSize: number }> {
  const dir = await ensureBlobDir();
  const blobRef = getBlobRef(params.secretId);
  const filePath = join(dir, `${blobRef}.bin`);

  const hash = createHash("sha256");
  let size = 0;

  const readable = Readable.fromWeb(
    params.body as unknown as NodeReadableStream
  );
  const writable = createWriteStream(filePath);

  const finished = new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
    readable.on("error", reject);
  });

  readable.on("data", (chunk: Uint8Array) => {
    hash.update(chunk);
    size += chunk.length;
  });

  readable.pipe(writable);
  await finished;

  return {
    blobRef,
    blobHash: hash.digest("hex"),
    blobSize: size,
  };
}

export async function readSecretBlob(params: {
  blobRef: string;
}): Promise<ReadableStream<Uint8Array> | null> {
  const dir = await ensureBlobDir();
  const filePath = join(dir, `${params.blobRef}.bin`);
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return null;
  }
  const stream = createReadStream(filePath);
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
