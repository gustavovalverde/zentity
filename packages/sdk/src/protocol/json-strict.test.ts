import { describe, expect, it } from "vitest";

import {
  decodeBase64UrlJsonStrict,
  decodeJwtHeaderStrict,
  decodeJwtPayloadStrict,
  parseStrictJson,
  parseStrictJsonObject,
} from "./json-strict";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function compactJwt(header: string, payload: string): string {
  return [base64url(header), base64url(payload), "signature"].join(".");
}

describe("parseStrictJsonObject", () => {
  it("accepts well-formed objects", () => {
    expect(parseStrictJsonObject('{"iss":"a","sub":"b"}')).toEqual({
      iss: "a",
      sub: "b",
    });
  });

  it("rejects duplicate top-level keys", () => {
    expect(() => parseStrictJsonObject('{"iss":"a","iss":"b"}')).toThrow(
      "Duplicate JSON key"
    );
  });

  it("rejects duplicate keys at any nesting depth", () => {
    expect(() =>
      parseStrictJsonObject('{"cnf":{"jwk":"a","jwk":"b"}}')
    ).toThrow("Duplicate JSON key");
  });

  it("rejects Unicode-encoded duplicates after escape decoding", () => {
    expect(() =>
      parseStrictJsonObject('{"iss":"x","\\u0069\\u0073\\u0073":"y"}')
    ).toThrow("Duplicate JSON key");
  });

  it("rejects trailing data", () => {
    expect(() => parseStrictJsonObject('{"a":1}garbage')).toThrow(
      "Unexpected JSON trailing data"
    );
  });

  it("rejects arrays at the top level", () => {
    expect(() => parseStrictJsonObject('["a","b"]')).toThrow(
      "Expected JSON object"
    );
  });

  it("rejects unterminated strings", () => {
    expect(() => parseStrictJsonObject('{"a":"b')).toThrow(
      "Unterminated JSON string"
    );
  });
});

describe("parseStrictJson", () => {
  it("parses arrays without flagging them as non-objects", () => {
    expect(parseStrictJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it("rejects duplicate keys inside array elements", () => {
    expect(() => parseStrictJson('[{"a":1,"a":2}]')).toThrow(
      "Duplicate JSON key"
    );
  });
});

describe("decodeBase64UrlJsonStrict", () => {
  it("decodes valid base64url JSON", () => {
    expect(
      decodeBase64UrlJsonStrict(base64url('["salt","name","Alice"]'))
    ).toEqual(["salt", "name", "Alice"]);
  });

  it("rejects duplicate keys in base64url-encoded payloads", () => {
    expect(() =>
      decodeBase64UrlJsonStrict(base64url('{"a":1,"a":2}'))
    ).toThrow("Duplicate JSON key");
  });
});

describe("decodeJwtHeaderStrict", () => {
  it("decodes a well-formed JWT header", () => {
    const token = compactJwt('{"alg":"ES256"}', '{"iss":"x"}');
    expect(decodeJwtHeaderStrict(token)).toEqual({ alg: "ES256" });
  });

  it("rejects duplicate keys in the JWT header", () => {
    const token = compactJwt(
      '{"alg":"ES256","alg":"none"}',
      '{"iss":"x"}'
    );
    expect(() => decodeJwtHeaderStrict(token)).toThrow("Duplicate JSON key");
  });
});

describe("decodeJwtPayloadStrict", () => {
  it("decodes a well-formed JWT payload", () => {
    const token = compactJwt('{"alg":"ES256"}', '{"iss":"x","sub":"y"}');
    expect(decodeJwtPayloadStrict(token)).toEqual({ iss: "x", sub: "y" });
  });

  it("rejects compact JWTs that are not three segments", () => {
    expect(() => decodeJwtPayloadStrict("only.two")).toThrow(
      "Expected compact JWT"
    );
  });

  it("rejects duplicate claims in the JWT payload", () => {
    const token = compactJwt(
      '{"alg":"ES256"}',
      '{"iss":"good","iss":"evil"}'
    );
    expect(() => decodeJwtPayloadStrict(token)).toThrow("Duplicate JSON key");
  });
});
