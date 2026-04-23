import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFirstPartyAuthFileStorage } from "./first-party-auth-storage.js";

const TEMP_DIRECTORIES: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "zentity-sdk-node-"));
  TEMP_DIRECTORIES.push(directory);
  return directory;
}

afterEach(() => {
  while (TEMP_DIRECTORIES.length > 0) {
    const directory = TEMP_DIRECTORIES.pop();
    if (directory) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("createFirstPartyAuthFileStorage", () => {
  it("requires a non-empty namespace", () => {
    expect(() =>
      createFirstPartyAuthFileStorage({
        baseDir: createTempDirectory(),
        issuerUrl: "http://localhost:3000/",
        namespace: "",
      })
    ).toThrow("First-party auth file storage requires a non-empty namespace");
  });

  it("persists state in a per-issuer file", () => {
    const baseDir = createTempDirectory();
    const storage = createFirstPartyAuthFileStorage({
      baseDir,
      issuerUrl: "http://localhost:3000/",
      namespace: "mcp-server",
    });

    storage.save({
      accessToken: "access-token",
      clientId: "client-1",
      loginHint: "user@example.com",
    });

    expect(storage.load()).toEqual({
      accessToken: "access-token",
      clientId: "client-1",
      loginHint: "user@example.com",
    });
  });

  it("loads legacy credentials when requested and no new storage file exists", () => {
    const baseDir = createTempDirectory();
    const legacyCredentialFilePath = join(baseDir, "credentials.json");
    writeFileSync(
      legacyCredentialFilePath,
      JSON.stringify(
        {
          zentityUrl: "http://localhost:3000/",
          clientId: "client-legacy",
          accessToken: "legacy-access-token",
          dpopJwk: { kty: "EC", crv: "P-256" },
          dpopPublicJwk: { kty: "EC", crv: "P-256" },
          registrationMethod: "dcr",
        },
        null,
        2
      )
    );

    const storage = createFirstPartyAuthFileStorage({
      baseDir,
      issuerUrl: "http://localhost:3000",
      legacyCredentialFilePath,
      namespace: "mcp-server",
    });

    expect(storage.load()).toEqual({
      accessToken: "legacy-access-token",
      clientId: "client-legacy",
      dpopKeyPair: {
        privateJwk: { kty: "EC", crv: "P-256" },
        publicJwk: { kty: "EC", crv: "P-256" },
      },
      registrationMethod: "dcr",
    });
  });

  it("writes an issuer-tagged envelope for future loads", () => {
    const baseDir = createTempDirectory();
    const storage = createFirstPartyAuthFileStorage({
      baseDir,
      issuerUrl: "http://localhost:3000/",
      namespace: "mcp-server",
    });

    storage.save({
      clientId: "client-1",
      refreshToken: "refresh-token",
    });

    const storageDirectory = join(baseDir, "mcp-server", "first-party-auth");
    const [filename] = readdirSync(storageDirectory);
    expect(filename).toBeDefined();
    expect(
      JSON.parse(
        readFileSync(join(storageDirectory, filename as string), "utf-8")
      )
    ).toEqual({
      issuerUrl: "http://localhost:3000",
      state: {
        clientId: "client-1",
        refreshToken: "refresh-token",
      },
    });
  });
});
