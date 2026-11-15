import { readdir, readFile, rm } from "node:fs/promises";

import { afterAll, describe, expect, it, vi } from "vitest";

const blobDir = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  return mkdtempSync(join(tmpdir(), "zentity-secret-blobs-"));
});

vi.mock("@/env", () => ({ env: { SECRET_BLOB_DIR: blobDir } }));

import { writeSecretBlob } from "../storage.server";

function body(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

describe("writeSecretBlob", () => {
  afterAll(async () => {
    await rm(blobDir, { recursive: true, force: true });
  });

  it("replaces an existing blob for the same secret", async () => {
    const secretId = crypto.randomUUID();

    const first = await writeSecretBlob({ secretId, body: body("first") });
    const second = await writeSecretBlob({ secretId, body: body("second") });

    expect(second.blobRef).toBe(first.blobRef);
    expect(second.blobSize).toBe(6);
    await expect(
      readFile(`${blobDir}/${second.blobRef}.bin`, "utf8")
    ).resolves.toBe("second");
    await expect(readdir(blobDir)).resolves.toEqual([`${second.blobRef}.bin`]);
  });
});
