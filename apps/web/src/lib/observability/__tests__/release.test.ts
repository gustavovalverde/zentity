import { afterEach, describe, expect, it, vi } from "vitest";

const RELEASE_VARS = [
  "GIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "APP_VERSION",
  "RELEASE_ID",
] as const;

function setReleaseEnv(
  values: Partial<Record<(typeof RELEASE_VARS)[number], string>>
) {
  for (const name of RELEASE_VARS) {
    vi.stubEnv(name, values[name] ?? "");
  }
  vi.resetModules();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/env");
  vi.doUnmock("node:child_process");
});

describe("getReleaseId", () => {
  it("prefers GIT_SHA, then Vercel, then Railway", async () => {
    setReleaseEnv({
      GIT_SHA: "git",
      VERCEL_GIT_COMMIT_SHA: "vercel",
      RAILWAY_GIT_COMMIT_SHA: "railway",
    });
    expect((await import("../release")).getReleaseId()).toBe("git");

    setReleaseEnv({
      VERCEL_GIT_COMMIT_SHA: "vercel",
      RAILWAY_GIT_COMMIT_SHA: "railway",
    });
    expect((await import("../release")).getReleaseId()).toBe("vercel");

    setReleaseEnv({ RAILWAY_GIT_COMMIT_SHA: "railway" });
    expect((await import("../release")).getReleaseId()).toBe("railway");
  });

  it("falls back to dev, treating the Dockerfile default as unset", async () => {
    setReleaseEnv({});
    expect((await import("../release")).getReleaseId()).toBe("dev");

    setReleaseEnv({ GIT_SHA: "unknown", RAILWAY_GIT_COMMIT_SHA: "railway" });
    expect((await import("../release")).getReleaseId()).toBe("railway");
  });
});

describe("with only GIT_SHA set", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("reports it as telemetry service.version and build-info gitSha", async () => {
    setReleaseEnv({ GIT_SHA: sha });
    vi.stubEnv("APP_VERSION", "9.9.9");

    const { getServiceVersion } = await import("../telemetry");
    expect(getServiceVersion()).toBe(sha);

    const { GET } = await import("@/app/api/status/build-info/route");
    const body = await (GET() as Response).json();
    expect(body.gitSha).toBe(sha);
  });
});

describe("build-info without a known commit", () => {
  it("does not shell out to git in production", async () => {
    setReleaseEnv({});
    vi.doMock("@/env", () => ({ env: { NODE_ENV: "production" } }));
    const execSync = vi.fn(() => Buffer.from("from-git\n"));
    vi.doMock("node:child_process", () => ({ execSync }));

    const { GET } = await import("@/app/api/status/build-info/route");
    const body = await (GET() as Response).json();

    expect(body.gitSha).toBe("dev");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("reads the local git commit outside production", async () => {
    setReleaseEnv({});
    vi.doMock("@/env", () => ({ env: { NODE_ENV: "development" } }));
    vi.doMock("node:child_process", () => ({
      execSync: () => Buffer.from("from-git\n"),
    }));

    const { GET } = await import("@/app/api/status/build-info/route");
    const body = await (GET() as Response).json();

    expect(body.gitSha).toBe("from-git");
  });
});
