export function assertNoRawIdentifierInClaims(
  claims: Record<string, unknown>,
  rawIdentifier: string
): void {
  if ("uniqueIdentifier" in claims) {
    throw new Error("Raw uniqueIdentifier leaked into claims");
  }
  if (claims.sybil_nullifier === rawIdentifier) {
    throw new Error("sybil_nullifier matched the raw identifier");
  }
  if (JSON.stringify(claims).includes(rawIdentifier)) {
    throw new Error("Raw identifier leaked into claims");
  }
}
