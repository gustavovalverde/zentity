import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isPermittedDestination,
  isSafePathSegments,
  validateOutboundUrl,
} from "@/lib/http/url-safety";

describe("public address classification", () => {
  const publicHost = new URL("https://rp.example.com/p");

  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
  ])("rejects %s", (address) => {
    expect(isPermittedDestination(publicHost, address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.215.14",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("accepts %s", (address) => {
    expect(isPermittedDestination(publicHost, address)).toBe(true);
  });
});

describe("validateOutboundUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts public HTTPS URLs", () => {
    expect(validateOutboundUrl("https://rp.example.com/validity")).toBeNull();
    expect(validateOutboundUrl("https://8.8.8.8/validity")).toBeNull();
  });

  it.each([
    "https://127.0.0.1/p",
    "https://10.0.0.1/p",
    "https://172.16.0.1/p",
    "https://192.168.0.1/p",
    "https://169.254.169.254/latest/meta-data",
    "https://[fc00::1]/p",
    "https://[fe80::1]/p",
    "https://[::ffff:127.0.0.1]/p",
    "https://[::ffff:a00:1]/p",
    "https://2130706433/p",
    "https://0x7f000001/p",
    "https://0177.0.0.1/p",
    "https://017700000001/p",
    "https://10.1/p",
    "https://0/p",
  ])("rejects private or reserved literal %s", (url) => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateOutboundUrl(url)).toContain("private or reserved");
  });

  it.each([
    "https://fhe.railway.internal/p",
    "https://metadata.google.internal/p",
    "https://printer.local/p",
    "https://router.home.arpa/p",
    "https://app.localhost/p",
    "https://localhost/p",
    "https://ocr/p",
    "https://fhe.railway.internal./p",
  ])("rejects internal hostname %s", (url) => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateOutboundUrl(url)).toContain("internal host");
  });

  it("requires HTTPS for public hosts", () => {
    expect(validateOutboundUrl("http://rp.example.com/p")).toContain("HTTPS");
  });

  it("rejects non-HTTP schemes", () => {
    expect(validateOutboundUrl("ftp://rp.example.com/p")).toContain("HTTPS");
    expect(validateOutboundUrl("file:///etc/passwd")).toContain("HTTPS");
  });

  it("rejects embedded credentials", () => {
    expect(validateOutboundUrl("https://user:pw@rp.example.com/p")).toContain(
      "credentials"
    );
  });

  it("rejects unparseable URLs", () => {
    expect(validateOutboundUrl("not a url")).toContain("not a valid URL");
  });

  it.each([
    "http://localhost:3102/validity",
    "http://127.0.0.1:3102/validity",
    "http://[::1]:3102/validity",
  ])("allows loopback %s outside production", (url) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(validateOutboundUrl(url)).toBeNull();
  });

  it.each([
    "http://localhost:3102/validity",
    "https://localhost:3102/validity",
    "http://127.0.0.1:3102/validity",
  ])("rejects loopback %s in production", (url) => {
    vi.stubEnv("NODE_ENV", "production");
    expect(validateOutboundUrl(url)).not.toBeNull();
  });
});

describe("isPermittedDestination", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires every public hostname to resolve publicly", () => {
    const url = new URL("https://rp.example.com/p");
    expect(isPermittedDestination(url, "93.184.215.14")).toBe(true);
    expect(isPermittedDestination(url, "127.0.0.1")).toBe(false);
    expect(isPermittedDestination(url, "10.0.0.8")).toBe(false);
    expect(isPermittedDestination(url, "::ffff:169.254.169.254")).toBe(false);
  });

  it("confines loopback hostnames to loopback addresses outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const url = new URL("http://localhost:3102/p");
    expect(isPermittedDestination(url, "127.0.0.1")).toBe(true);
    expect(isPermittedDestination(url, "::1")).toBe(true);
    expect(isPermittedDestination(url, "10.0.0.8")).toBe(false);
    expect(isPermittedDestination(url, "93.184.215.14")).toBe(false);
  });

  it("refuses loopback hostnames in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const url = new URL("http://localhost:3102/p");
    expect(isPermittedDestination(url, "127.0.0.1")).toBe(false);
  });
});

describe("isSafePathSegments", () => {
  it.each([
    [["encrypt"]],
    [["v1", "encrypt"]],
    [["keys", "public-key.json"]],
    [["a", "b_c-d", "e.f.g"]],
  ])("accepts %j", (segments) => {
    expect(isSafePathSegments(segments)).toBe(true);
  });

  it.each([
    [[]],
    [[""]],
    [["."]],
    [[".."]],
    [["..", "encrypt"]],
    [[".hidden"]],
    [["trailing."]],
    [["a/b"]],
    [["a\\b"]],
    [["a b"]],
    [["a?b"]],
    [["%2e%2e"]],
    [[undefined]],
  ])("rejects %j", (segments) => {
    expect(isSafePathSegments(segments)).toBe(false);
  });
});
