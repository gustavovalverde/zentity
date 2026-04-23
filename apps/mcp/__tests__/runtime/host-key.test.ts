import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_URL = "http://localhost:3000";

function hashNamespace(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const TRAILING_SLASHES = /\/+$/;
function normalizeUrl(url: string): string {
  return url.replace(TRAILING_SLASHES, "");
}

describe("host-key persistence", () => {
  let fakeHome: string;
  let hostsDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "zentity-host-key-"));
    hostsDir = join(fakeHome, "hosts");
    vi.stubEnv("ZENTITY_MCP_HOST_KEY_DIR", hostsDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("stores host keys in the client namespace", async () => {
    mkdirSync(hostsDir, { recursive: true });

    const clientPath = join(
      hostsDir,
      `${hashNamespace(`${normalizeUrl(TEST_URL)}:initial-client`)}.json`
    );

    const hostKey = {
      hostId: "host-123",
      privateKey: { kty: "OKP" },
      publicKey: { kty: "OKP" },
    };

    const hostKeyModule = await import("../../src/runtime/host-key.js");

    hostKeyModule.saveHostKey(TEST_URL, "initial-client", hostKey);

    expect(existsSync(clientPath)).toBe(true);
    expect(JSON.parse(readFileSync(clientPath, "utf8"))).toEqual(hostKey);

    expect(hostKeyModule.loadHostKey(TEST_URL, "initial-client")).toEqual(
      hostKey
    );
  });

  it("keeps different clients isolated", async () => {
    mkdirSync(hostsDir, { recursive: true });

    const initialPath = join(
      hostsDir,
      `${hashNamespace(`${normalizeUrl(TEST_URL)}:initial-client`)}.json`
    );
    const hostKey = {
      hostId: "host-123",
      privateKey: { kty: "OKP" },
      publicKey: { kty: "OKP" },
    };
    writeFileSync(initialPath, JSON.stringify(hostKey), { mode: 0o600 });

    const hostKeyModule = await import("../../src/runtime/host-key.js");

    expect(hostKeyModule.loadHostKey(TEST_URL, "initial-client")).toEqual(
      hostKey
    );
    expect(
      hostKeyModule.loadHostKey(TEST_URL, "rotated-client")
    ).toBeUndefined();
  });
});
