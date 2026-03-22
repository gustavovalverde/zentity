#!/usr/bin/env tsx

/**
 * CIBA CLI Test Harness
 *
 * Exercises the full CIBA + DPoP flow via HTTP against a running Zentity server.
 * Simulates the same path a real MCP client (e.g., Claude CLI) would take.
 *
 * Usage: pnpm exec tsx scripts/ciba-cli-test.ts --email <user-email> [options]
 */

import {
  calculateJwkThumbprint,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function ok(msg: string) {
  console.log(`${c.green}  ✓${c.reset} ${msg}`);
}
function fail(msg: string) {
  console.error(`${c.red}  ✗ ${msg}${c.reset}`);
}
function info(msg: string) {
  console.log(`${c.cyan}  ℹ${c.reset} ${msg}`);
}
function heading(step: string, title: string) {
  console.log(`\n${c.bold}${c.blue}━━━ Step ${step}: ${title} ━━━${c.reset}\n`);
}
function box(lines: string[]) {
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length));
  const border = "─".repeat(maxLen + 2);
  console.log(`${c.yellow}  ┌${border}┐${c.reset}`);
  for (const line of lines) {
    const pad = " ".repeat(maxLen - stripAnsi(line).length);
    console.log(
      `${c.yellow}  │${c.reset} ${line}${pad} ${c.yellow}│${c.reset}`
    );
  }
  console.log(`${c.yellow}  └${border}┘${c.reset}`);
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching ESC control character
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface Args {
  baseUrl: string;
  bindingMessage?: string | undefined;
  clientId?: string | undefined;
  email: string;
  scope: string;
  timeout: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Partial<Args> = {
    baseUrl: "http://localhost:3000",
    scope: "openid",
    timeout: 300,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1] ?? "";
    switch (arg) {
      case "--email":
        args.email = next;
        i++;
        break;
      case "--base-url":
        args.baseUrl = next;
        i++;
        break;
      case "--client-id":
        args.clientId = next;
        i++;
        break;
      case "--scope":
        args.scope = next;
        i++;
        break;
      case "--binding-message":
        args.bindingMessage = next;
        i++;
        break;
      case "--timeout":
        args.timeout = Number.parseInt(next ?? "30000", 10);
        i++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--":
        break;
      default:
        fail(`Unknown option: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!args.email) {
    fail("--email is required");
    printUsage();
    process.exit(1);
  }

  return args as Args;
}

function printUsage() {
  console.log(`
${c.bold}CIBA CLI Test Harness${c.reset}

${c.dim}Usage:${c.reset}
  pnpm exec tsx scripts/ciba-cli-test.ts --email <user-email> [options]

${c.dim}Options:${c.reset}
  --email <email>           User email (login_hint). Required.
  --base-url <url>          Server URL (default: http://localhost:3000)
  --client-id <id>          Skip DCR, use existing client
  --scope <scope>           Scope string (default: openid)
  --binding-message <msg>   Human-readable binding message
  --timeout <seconds>       Max approval wait (default: 300)
  --help, -h                Show this help
`);
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // Unwrap better-auth's { response: ... } envelope
      body =
        parsed && typeof parsed === "object" && "response" in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, headers: response.headers };
}

// ── DPoP ────────────────────────────────────────────────────────────────────

interface DpopClient {
  proofFor(method: string, url: string, nonce?: string): Promise<string>;
  publicJwk: JWK;
  thumbprint: string;
}

async function createDpopClient(): Promise<DpopClient> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  const thumbprint = await calculateJwkThumbprint(publicJwk, "sha256");

  function proofFor(
    method: string,
    url: string,
    nonce?: string
  ): Promise<string> {
    return new SignJWT({
      htm: method,
      htu: url,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      ...(nonce ? { nonce } : {}),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk })
      .setIssuedAt()
      .sign(privateKey);
  }

  return { publicJwk, thumbprint, proofFor };
}

// ── Spinner ─────────────────────────────────────────────────────────────────

function createSpinner(label: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const start = Date.now();

  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(
      `\r${c.cyan}  ${frames[i % frames.length]}${c.reset} ${label} ${c.dim}(${elapsed}s)${c.reset}  `
    );
    i++;
  }, 80);

  return {
    stop(finalMsg: string) {
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat(60)}\r`);
      console.log(finalMsg);
    },
  };
}

// ── Steps ───────────────────────────────────────────────────────────────────

const results: { step: string; ok: boolean }[] = [];

function record(step: string, passed: boolean) {
  results.push({ step, ok: passed });
}

async function step0Discovery(base: string) {
  heading("0", "Discovery");

  const url = `${base}/.well-known/oauth-authorization-server/api/auth`;
  let res: Awaited<ReturnType<typeof fetchJson>>;
  try {
    res = await fetchJson(url);
  } catch {
    fail(`Cannot connect to ${base}. Is the dev server running?`);
    process.exit(1);
  }

  if (res.status !== 200) {
    fail(`Discovery returned ${res.status}`);
    record("Discovery", false);
    return null;
  }

  const meta = res.body;
  info(`issuer: ${meta.issuer}`);
  info(`token_endpoint: ${meta.token_endpoint}`);
  info(
    `CIBA: ${meta.backchannel_authentication_endpoint ? "supported" : "not found"}`
  );
  info(
    `DPoP algs: ${JSON.stringify(meta.dpop_signing_alg_values_supported ?? "none")}`
  );

  ok("Server is reachable");
  record("Discovery", true);
  return meta;
}

async function step1Dcr(
  base: string,
  existingClientId?: string
): Promise<string> {
  heading("1", "Dynamic Client Registration");

  if (existingClientId) {
    info(`Using existing client_id: ${existingClientId}`);
    record("DCR", true);
    return existingClientId;
  }

  const res = await fetchJson(`${base}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: `CIBA CLI Test ${Date.now()}`,
      redirect_uris: ["http://localhost/ciba-cli-callback"],
      scope: "openid",
      token_endpoint_auth_method: "none",
      grant_types: ["urn:openid:params:grant-type:ciba"],
    }),
  });

  if (res.status >= 300) {
    fail(
      `DCR failed (${res.status}): ${res.body.error_description ?? res.body.error ?? JSON.stringify(res.body)}`
    );
    record("DCR", false);
    process.exit(1);
  }

  const clientId = res.body.client_id as string;
  ok(`Registered client: ${clientId}`);
  record("DCR", true);
  return clientId;
}

async function step2BcAuthorize(
  base: string,
  clientId: string,
  email: string,
  scope: string,
  bindingMessage?: string
): Promise<{ authReqId: string; expiresIn: number; interval: number }> {
  heading("2", "CIBA Backchannel Authorize");

  const res = await fetchJson(`${base}/api/auth/oauth2/bc-authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      scope,
      login_hint: email,
      binding_message: bindingMessage ?? `CLI test ${Date.now()}`,
    }),
  });

  if (res.status >= 300) {
    const desc =
      (res.body.error_description as string) ??
      (res.body.error as string) ??
      JSON.stringify(res.body);

    if (desc.toLowerCase().includes("user")) {
      fail(`No user with email '${email}'. Sign up first at ${base}/sign-up`);
    } else {
      fail(`bc-authorize failed (${res.status}): ${desc}`);
    }
    record("CIBA Authorize", false);
    process.exit(1);
  }

  const authReqId = res.body.auth_req_id as string;
  const expiresIn = (res.body.expires_in as number) ?? 300;
  const interval = (res.body.interval as number) ?? 5;

  ok(`auth_req_id: ${authReqId}`);
  info(`expires_in: ${expiresIn}s, poll interval: ${interval}s`);

  const approvalUrl = `${base}/approve/${encodeURIComponent(authReqId)}?source=cli_handoff`;
  console.log();
  box([
    `${c.bold}Open this URL to approve the request:${c.reset}`,
    "",
    `${c.cyan}${approvalUrl}${c.reset}`,
  ]);

  record("CIBA Authorize", true);
  return { authReqId, expiresIn, interval };
}

async function step3TokenPolling(
  base: string,
  clientId: string,
  authReqId: string,
  interval: number,
  timeout: number,
  dpop: DpopClient
): Promise<Record<string, unknown>> {
  heading("3", "Token Polling with DPoP");

  const tokenUrl = `${base}/api/auth/oauth2/token`;
  const formBody = new URLSearchParams({
    grant_type: "urn:openid:params:grant-type:ciba",
    client_id: clientId,
    auth_req_id: authReqId,
  });

  let currentNonce: string | undefined;
  const startTime = Date.now();
  let currentInterval = interval;

  // Initial DPoP nonce acquisition — first request always returns a nonce
  info("Acquiring DPoP nonce...");
  const initProof = await dpop.proofFor("POST", tokenUrl);
  const initRes = await fetchJson(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: initProof,
    },
    body: formBody,
  });
  const initNonce = initRes.headers.get("DPoP-Nonce");
  if (initNonce) {
    currentNonce = initNonce;
    ok(`DPoP nonce acquired: ${currentNonce.slice(0, 16)}...`);
  }

  const spinner = createSpinner("Waiting for user approval");

  async function poll(): Promise<Record<string, unknown> | null> {
    const proof = await dpop.proofFor("POST", tokenUrl, currentNonce);
    const res = await fetchJson(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body: formBody,
    });

    // Always capture fresh nonce
    const freshNonce = res.headers.get("DPoP-Nonce");
    if (freshNonce) {
      currentNonce = freshNonce;
    }

    if (res.status >= 200 && res.status < 300 && res.body.access_token) {
      return res.body;
    }

    const errorCode = res.body.error as string | undefined;

    if (errorCode === "authorization_pending") {
      return null;
    }
    if (errorCode === "slow_down") {
      currentInterval += 5;
      info(`Server asked to slow down, interval now ${currentInterval}s`);
      return null;
    }
    if (errorCode === "access_denied") {
      spinner.stop("");
      fail("User denied the authorization request");
      record("Token Polling", false);
      process.exit(1);
    }
    if (errorCode === "expired_token") {
      spinner.stop("");
      fail("Authorization request expired");
      record("Token Polling", false);
      process.exit(1);
    }

    // If we got a DPoP nonce error, retry immediately with the new nonce
    if (
      (res.status === 400 || res.status === 401) &&
      freshNonce &&
      (res.body.error as string)?.includes("dpop")
    ) {
      return null;
    }

    // Unexpected error
    spinner.stop("");
    fail(
      `Token request failed (${res.status}): ${res.body.error_description ?? res.body.error ?? JSON.stringify(res.body)}`
    );
    record("Token Polling", false);
    process.exit(1);
  }

  // Poll loop
  while (true) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > timeout) {
      spinner.stop("");
      fail(`Timed out after ${timeout}s. Did you open the approval URL?`);
      record("Token Polling", false);
      process.exit(1);
    }

    const tokens = await poll();
    if (tokens) {
      spinner.stop(`${c.green}  ✓${c.reset} Tokens received!`);
      info(`token_type: ${tokens.token_type}`);
      info(`access_token: ${(tokens.access_token as string).slice(0, 32)}...`);
      if (tokens.id_token) {
        info(`id_token: ${(tokens.id_token as string).slice(0, 32)}...`);
      }
      record("Token Polling", true);
      return tokens;
    }

    await sleep(currentInterval * 1000);
  }
}

function step4TokenValidation(
  tokens: Record<string, unknown>,
  dpop: DpopClient
) {
  heading("4", "Token Validation");

  const accessToken = tokens.access_token as string;
  const isJwt = accessToken.split(".").length === 3;

  if (isJwt) {
    const claims = decodeJwt(accessToken);
    info("access_token format: JWT");
    info(`iss: ${claims.iss}`);
    info(`sub: ${claims.sub}`);
    info(`scope: ${claims.scope}`);
    info(
      `exp: ${claims.exp ? new Date(claims.exp * 1000).toISOString() : "none"}`
    );
    if (claims.act) {
      info(`act: ${JSON.stringify(claims.act)}`);
    }

    const cnf = claims.cnf as { jkt?: string } | undefined;
    if (cnf?.jkt) {
      info(`cnf.jkt: ${cnf.jkt}`);
      const matches = cnf.jkt === dpop.thumbprint;
      if (matches) {
        ok("DPoP thumbprint matches our keypair");
      } else {
        fail(
          `DPoP thumbprint mismatch: expected ${dpop.thumbprint}, got ${cnf.jkt}`
        );
      }
      record("Token Validation", matches);
      return;
    }
  } else {
    info("access_token format: opaque");
    info(`token_type: ${tokens.token_type}`);
    if (tokens.scope) {
      info(`scope: ${tokens.scope}`);
    }
    if (tokens.expires_in) {
      info(`expires_in: ${tokens.expires_in}s`);
    }
  }

  // Validate id_token if present (always a JWT)
  if (tokens.id_token) {
    const idClaims = decodeJwt(tokens.id_token as string);
    info(`id_token sub: ${idClaims.sub}`);
    info(`id_token iss: ${idClaims.iss}`);
    if (idClaims.exp) {
      info(`id_token exp: ${new Date(idClaims.exp * 1000).toISOString()}`);
    }

    const cnf = idClaims.cnf as { jkt?: string } | undefined;
    if (cnf?.jkt) {
      info(`id_token cnf.jkt: ${cnf.jkt}`);
      const matches = cnf.jkt === dpop.thumbprint;
      if (matches) {
        ok("DPoP thumbprint matches our keypair (via id_token)");
      } else {
        fail(
          `DPoP thumbprint mismatch: expected ${dpop.thumbprint}, got ${cnf.jkt}`
        );
      }
      record("Token Validation", matches);
      return;
    }
  }

  info("No cnf.jkt claim found (DPoP binding not in token claims)");
  ok("Token response structure valid");
  record("Token Validation", true);
}

async function step5ProtectedResource(base: string) {
  heading("5", "RFC 9728 Protected Resource Metadata");

  let res: Awaited<ReturnType<typeof fetchJson>>;
  try {
    res = await fetchJson(`${base}/.well-known/oauth-protected-resource`);
  } catch {
    info("Protected resource metadata endpoint not available (optional)");
    record("Protected Resource", true);
    return;
  }

  if (res.status !== 200) {
    info(
      `Protected resource metadata returned ${res.status} (optional endpoint)`
    );
    record("Protected Resource", true);
    return;
  }

  const meta = res.body;
  info(`resource: ${meta.resource}`);
  info(`authorization_servers: ${JSON.stringify(meta.authorization_servers)}`);
  if (meta.bearer_methods_supported) {
    info(`bearer_methods: ${JSON.stringify(meta.bearer_methods_supported)}`);
  }
  if (meta.scopes_supported) {
    info(`scopes: ${JSON.stringify(meta.scopes_supported)}`);
  }

  ok("Protected resource metadata retrieved");
  record("Protected Resource", true);
}

// ── Main ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs();

  console.log(
    `\n${c.bold}${c.magenta}╔═══════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.bold}${c.magenta}║    CIBA CLI Test Harness              ║${c.reset}`
  );
  console.log(
    `${c.bold}${c.magenta}╚═══════════════════════════════════════╝${c.reset}\n`
  );
  info(`Target: ${args.baseUrl}`);
  info(`Email:  ${args.email}`);
  info(`Scope:  ${args.scope}`);

  // Step 0
  await step0Discovery(args.baseUrl);

  // Step 1
  const clientId = await step1Dcr(args.baseUrl, args.clientId);

  // Step 2
  const { authReqId, interval } = await step2BcAuthorize(
    args.baseUrl,
    clientId,
    args.email,
    args.scope,
    args.bindingMessage
  );

  // DPoP keypair (shared across all token requests)
  info("\nGenerating ephemeral DPoP ES256 keypair...");
  const dpop = await createDpopClient();
  ok(`DPoP JWK thumbprint: ${dpop.thumbprint}`);

  // Step 3
  const tokens = await step3TokenPolling(
    args.baseUrl,
    clientId,
    authReqId,
    interval,
    args.timeout,
    dpop
  );

  // Step 4
  step4TokenValidation(tokens, dpop);

  // Step 5
  await step5ProtectedResource(args.baseUrl);

  // ── Summary ──
  console.log(`\n${c.bold}${c.blue}━━━ Summary ━━━${c.reset}\n`);
  for (const r of results) {
    const icon = r.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`  ${icon}  ${r.step}`);
  }

  const allPassed = results.every((r) => r.ok);
  console.log(
    allPassed
      ? `\n${c.green}${c.bold}  All checks passed!${c.reset}\n`
      : `\n${c.red}${c.bold}  Some checks failed.${c.reset}\n`
  );

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
