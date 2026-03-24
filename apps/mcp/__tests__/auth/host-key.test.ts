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

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "zentity-host-key-"));
    vi.resetModules();
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return {
        ...actual,
        homedir: () => fakeHome,
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("stores host keys in the client namespace", async () => {
    const hostsDir = join(fakeHome, ".zentity", "hosts");
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

    const hostKeyModule = await import("../../src/auth/host-key.js");

    hostKeyModule.saveHostKey(TEST_URL, "initial-client", hostKey);

    expect(existsSync(clientPath)).toBe(true);
    expect(JSON.parse(readFileSync(clientPath, "utf8"))).toEqual(hostKey);

    expect(hostKeyModule.loadHostKey(TEST_URL, "initial-client")).toEqual(
      hostKey
    );
  });

  it("keeps different clients isolated", async () => {
    const hostsDir = join(fakeHome, ".zentity", "hosts");
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

    const hostKeyModule = await import("../../src/auth/host-key.js");

    expect(hostKeyModule.loadHostKey(TEST_URL, "initial-client")).toEqual(
      hostKey
    );
    expect(
      hostKeyModule.loadHostKey(TEST_URL, "rotated-client")
    ).toBeUndefined();
  });
});
