/**
 * Integration-test setup, after vitest.setup.mts.
 *
 * The JWT plugin verifies access tokens against its `jwks.remoteUrl`, which a
 * running server serves from Zentity's own JWKS route over HTTP. Tests call
 * `auth.handler` in-process with no server listening, so that URL is answered
 * from the same route handler.
 */
const JWKS_PATH = "/api/auth/oauth2/jwks";
const nativeFetch = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

globalThis.fetch = async (input, init) => {
  if (new URL(requestUrl(input)).pathname === JWKS_PATH) {
    const { GET } = await import("@/app/api/auth/oauth2/jwks/route");
    return GET();
  }
  return nativeFetch(input, init);
};
