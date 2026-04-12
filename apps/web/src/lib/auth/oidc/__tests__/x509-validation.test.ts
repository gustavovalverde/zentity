import { describe, expect, it } from "vitest";

import { validateX509Chain } from "@/lib/auth/oidc/haip/x509-validation";

// Pre-generated test certificates (valid for 365 days from 2026-03-15)
// CA: self-signed RSA 2048, CN=Test CA
// Leaf: signed by CA, CN=Test Leaf
// Self-signed: separate self-signed cert, CN=Self Signed

const LEAF_DER =
  "MIICojCCAYoCCQCrFn3n0cqFMDANBgkqhkiG9w0BAQsFADASMRAwDgYDVQQDDAdUZXN0IENBMB4XDTI2MDMxNTE3MDUzM1oXDTI3MDMxNTE3MDUzM1owFDESMBAGA1UEAwwJVGVzdCBMZWFmMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1KiX9gmp7CqlNXiaYFjsokljzLPkwO77eB8TJ20kbhb1BqajUpHgGCxbaRpOEhVJRQcxYrVZ4oU2FOsPCJnc1Xc6UMgTkHgDjWbMIDILxA8o/JrmUEJPU6DvDUfTzvBvunqtlbwVSNsH3AaV/6rxIFc3XvLf02zhZ8YARwi9rwPSWe7HeoWiz+k5JYzH4pTJPgsFSAqXYSc55hYqxKRZZe5Zn25J4cMIA4HKRkoD6lraJdJyBieOD5euFIuJQQKDj3eVc2jKS3QKb+8hC077UK1ulfboFTgR4Jo6E6WfoDO7VuGWITMkP8C3Jm8/aSNB2osJXVwqcS+IVpxgo/UUpQIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQACKBlbgFNNm+rYQk53hX8EBuLp1ALyXiXsXdcRmhj3RDNwypH8Ytd29g9eUCEVxy6BgqPdARE6wDfz04SmTKmlzu/bBjHt+sXGxHTUGUUnq2ArsQ0IHnKlPt18hhsZXRPLfYxdyTgxWb8IXbJ1/jd2rtA2TZ5pXqxiWTWt2NeZaaYkZZ9aul3Fyr9v6JsmAvku0moaEU66Tudp/S/IMAj8ddZbLj3sn3/SspgBwKxthXtcspVgcN4u5m04DqubA1+8IXDkScl5YsnzmJw30zjVD1ZhP0guCAHsltLo31LY9mvr7sSTsfZfCg0vptt/sh2yIP+RYVzE3j5uawsZcRuo";

const CA_DER =
  "MIICoDCCAYgCCQCvuaawKTHV2jANBgkqhkiG9w0BAQsFADASMRAwDgYDVQQDDAdUZXN0IENBMB4XDTI2MDMxNTE3MDUzM1oXDTI3MDMxNTE3MDUzM1owEjEQMA4GA1UEAwwHVGVzdCBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMAyeCy0lwnHjW+DBdgKCU+w/lYDFFUe+tMntZ9UczjOhY8Li2p5PIql/i88bywBn2kZF7YqeGcFlawkOoBY2+BEa//T9DJhqXE1PiD0aD8sPbyEOoUeQhGqyVU5oEKWhPXVm/134cB/9nSE+Y9ksQXd3aqbcXqLlVOfkP7+Nnm5nytTB/Kc5qjdUa+ZoErygO67aDoFsCfNbyQ004ewLmcUmhQUdLk6dI90+cBvRVIa4FzVlbH4he5kbgaijXBEEnYfQV0VC6jk37hmmEIPi+nvcScew5qygotg0NkdsShupIOPTrti5mhxT6wxxCBPJKu+VUdbY6nxr1RCUK7ukrECAwEAATANBgkqhkiG9w0BAQsFAAOCAQEAfS59icvtoqFgEib77dUPX6gJ0s2CWwWfB09wVCK+0U08J6epN6+vSStVwzXg9eVfFqP9FmTF17XP115dTyIyii2l/T9CEm9LN27T3TPajuuQqBZP0pYdzP6ZjCn8bIneXNRTfcyJ/OeV3VOZsdDqhN40TF4OSXQqRy6TeY8Zb+WKd91URt+ZMS1Dkc08D2Ufkn9GqNZPT1FwIyNxmpPh3eJJ1peFXDSwuTCTxyzTasLM57r6N4cPwKNoDkRnKtcccugsFblI4su99yXm7mfF4MV/03j6XllCp6+6BAeMVfsP6cbALlsK18KioxcJh5XZCHVXdH0PbnDQ3f3A6KLnLw==";

const SELF_SIGNED_DER =
  "MIICqDCCAZACCQClmdktUaaluDANBgkqhkiG9w0BAQsFADAWMRQwEgYDVQQDDAtTZWxmIFNpZ25lZDAeFw0yNjAzMTUxNzA1MzNaFw0yNzAzMTUxNzA1MzNaMBYxFDASBgNVBAMMC1NlbGYgU2lnbmVkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqmgEso0km01Sa5CsrT/tUk2L0ysZZ3U4ogNye/aAM8UXogB5XDB4hzAO0jFFDHgeZ5u3/rH+rPKjGuH182MHGarQmR+Nh/fxA1QaiKxsOR1iViWmhjAnBtVLID1OIPmw8O6PRoIAuPokgcdWu7nUSHqDvXT7NKrVddxdj7W0mtUZR0VJEsxZEr6hnvxsRcPqq1tFc8wF60c3GasggcOJ6jABYS7Q4JthgMcYwhLompU3xtNpW58EtYMfAEMvEq0n5cxB9FY0YZhITbeNTV+MgBjiaTgH0PbkK59rV17Ql/Pn8q7Y2ZdDqAluC54LZFdKZfNRQBu2v0ttMOBZPa6I2wIDAQABMA0GCSqGSIb3DQEBCwUAA4IBAQBAy9akK35Skn+6VlJoaAXTlECb+bFjMlAjQ4s668w9CPkr0ANbUGqWQFB6snWJ5LOYcYdiOsvFnhkIK60V9KM9xlCg4JeqZuqFwowYsVNL3x34n4rUKvepHmKFSWPGo7FElM/XrohUstRDXonHLc4ZKvVjRl2K1hZHZINAVLkO/rlgksUBMYlvir/4bojUlt+Xv6XX4jqSHjTS0UJtWZZVcIfiy+Htc3aI6j5sHEoGYi+3ePvCZDOQXPOZzHmqc9Yq2T6aIXWCzpBl/BRTL243OAsZsiV5CJTnmQlL6f8sKomk+YTmQL6dyLtk4k7otn7OaT3uCENz5HrOLYV7st4L";

const LEAF_THUMBPRINT = "qNKoGvlEH94xt8BAqOL8wfFZozpZoBs6e3A7QZMYihk";
const SELF_SIGNED_THUMBPRINT = "9kcQeGPEkafQIMY_ONmcrIXkG5YNaMM106D8tLCXF8Y";

describe("validateX509Chain", () => {
  it("accepts a valid chain with correct thumbprint", () => {
    const result = validateX509Chain(LEAF_THUMBPRINT, [LEAF_DER, CA_DER]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects when thumbprint does not match client_id", () => {
    const result = validateX509Chain("wrong-thumbprint", [LEAF_DER, CA_DER]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("thumbprint");
  });

  it("rejects a self-signed leaf not issued by the CA", () => {
    const result = validateX509Chain(SELF_SIGNED_THUMBPRINT, [
      SELF_SIGNED_DER,
      CA_DER,
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not issued by the CA");
  });

  it("rejects chain with fewer than 2 certificates", () => {
    const result = validateX509Chain(LEAF_THUMBPRINT, [LEAF_DER]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least leaf and CA");
  });

  it("rejects invalid certificate data", () => {
    const result = validateX509Chain("foo", ["not-a-cert", "also-not-a-cert"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("parse");
  });
});
