// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getVerifierClientId, loadCertChain } from "./x509";

// Self-signed P-256 test certificate. The expected values come from
// `openssl x509 -outform der`, independently of the code under test.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBlTCCATugAwIBAgIUWi5kOcij56P+khRevF1SSZp8w/AwCgYIKoZIzj0EAwIw
IDEeMBwGA1UEAwwVZGVtby1ycCB0ZXN0IHZlcmlmaWVyMB4XDTI2MTExNTE2NDcy
OFoXDTM2MTExMjE2NDcyOFowIDEeMBwGA1UEAwwVZGVtby1ycCB0ZXN0IHZlcmlm
aWVyMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBU4xkDpkiC1cNiUba/aiaDet
KxibSMgwXj3jF5vOH5b9VezA0t2l5VjkV9whC1MD1ppnaTvIe+34+0zOfvHrs6NT
MFEwHQYDVR0OBBYEFLt90Sy23aYs/TYaJHnEY87iaIs0MB8GA1UdIwQYMBaAFLt9
0Sy23aYs/TYaJHnEY87iaIs0MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwID
SAAwRQIgLxUQxeU0AUrL/RGqhUH6XHGguG87hsEflFk6MKIX2PoCIQDN7VbgcxmO
GnsFu3+51PUE/18XdhsxSRYelN7cJzjlPg==
-----END CERTIFICATE-----
`;
const CERT_DER_BASE64 =
  "MIIBlTCCATugAwIBAgIUWi5kOcij56P+khRevF1SSZp8w/AwCgYIKoZIzj0EAwIwIDEeMBwGA1UEAwwVZGVtby1ycCB0ZXN0IHZlcmlmaWVyMB4XDTI2MTExNTE2NDcyOFoXDTM2MTExMjE2NDcyOFowIDEeMBwGA1UEAwwVZGVtby1ycCB0ZXN0IHZlcmlmaWVyMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBU4xkDpkiC1cNiUba/aiaDetKxibSMgwXj3jF5vOH5b9VezA0t2l5VjkV9whC1MD1ppnaTvIe+34+0zOfvHrs6NTMFEwHQYDVR0OBBYEFLt90Sy23aYs/TYaJHnEY87iaIs0MB8GA1UdIwQYMBaAFLt90Sy23aYs/TYaJHnEY87iaIs0MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgLxUQxeU0AUrL/RGqhUH6XHGguG87hsEflFk6MKIX2PoCIQDN7VbgcxmOGnsFu3+51PUE/18XdhsxSRYelN7cJzjlPg==";
const CERT_X509_HASH = "AMQR2IWM7roAu16_yd-p3eZjUBZw4pVradCY762iid8";

describe("verifier certificates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives the x509_hash Client Identifier from the DER encoding", () => {
    expect(getVerifierClientId(CERT_PEM)).toBe(`x509_hash:${CERT_X509_HASH}`);
  });

  it("returns x5c entries as base64 DER", () => {
    const envPem = Buffer.from(CERT_PEM).toString("base64");
    vi.stubEnv("VERIFIER_LEAF_PEM", envPem);
    vi.stubEnv("VERIFIER_CA_PEM", envPem);

    expect(loadCertChain("/nonexistent")).toEqual([
      CERT_DER_BASE64,
      CERT_DER_BASE64,
    ]);
  });

  it("rejects a PEM that is not a certificate", () => {
    expect(() => getVerifierClientId("not a certificate")).toThrow();
  });
});
