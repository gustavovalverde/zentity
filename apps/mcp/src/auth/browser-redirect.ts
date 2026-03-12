import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { platform } from "node:os";
import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";
import type { PkceChallenge } from "./pkce.js";
import type { TokenResult } from "./token-exchange.js";
import { exchangeAuthCode } from "./token-exchange.js";

const CALLBACK_TIMEOUT_MS = 120_000;

export interface BrowserRedirectParams {
  authorizeEndpoint: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  parEndpoint?: string;
  pkce: PkceChallenge;
  resource?: string;
  tokenEndpoint: string;
}

/**
 * Browser-based OAuth fallback for passkey-only users.
 *
 * Starts a local HTTP server on an ephemeral port, opens the browser
 * to the authorization endpoint, and waits for the callback with an
 * authorization code.
 */
export async function authenticateViaBrowser(
  params: BrowserRedirectParams
): Promise<TokenResult> {
  const { port, close, waitForCode } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    let authorizeUrl: string;

    if (params.parEndpoint) {
      authorizeUrl = await pushAuthorizationRequest(params, redirectUri);
    } else {
      const url = new URL(params.authorizeEndpoint);
      url.searchParams.set("client_id", params.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "openid email");
      url.searchParams.set("code_challenge", params.pkce.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      if (params.resource) {
        url.searchParams.set("resource", params.resource);
      }
      authorizeUrl = url.toString();
    }

    console.error(
      "[auth] Opening browser for authentication... Waiting for callback."
    );
    openBrowser(authorizeUrl);

    const code = await waitForCode;

    return await exchangeAuthCode(
      params.tokenEndpoint,
      code,
      params.pkce.codeVerifier,
      params.clientId,
      redirectUri,
      params.dpopKey,
      params.resource
    );
  } finally {
    close();
  }
}

async function pushAuthorizationRequest(
  params: BrowserRedirectParams,
  redirectUri: string
): Promise<string> {
  const parEndpoint = params.parEndpoint as string;
  const body = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email",
    code_challenge: params.pkce.codeChallenge,
    code_challenge_method: "S256",
  });
  if (params.resource) {
    body.set("resource", params.resource);
  }

  let dpopNonce: string | undefined;
  let dpopProof = await createDpopProof(
    params.dpopKey,
    "POST",
    parEndpoint,
    undefined,
    dpopNonce
  );

  let response = await fetch(parEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body,
  });

  // DPoP nonce retry
  if (response.status === 400 || response.status === 401) {
    const newNonce = extractDpopNonce(response);
    if (newNonce) {
      dpopNonce = newNonce;
      dpopProof = await createDpopProof(
        params.dpopKey,
        "POST",
        parEndpoint,
        undefined,
        dpopNonce
      );
      response = await fetch(parEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: dpopProof,
        },
        body,
      });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PAR request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    request_uri: string;
    expires_in: number;
  };

  const url = new URL(params.authorizeEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("request_uri", data.request_uri);
  return url.toString();
}

interface CallbackServer {
  close: () => void;
  port: number;
  waitForCode: Promise<string>;
}

function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let codeResolve!: (code: string) => void;
    let codeReject!: (error: Error) => void;

    const waitForCode = new Promise<string>((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    const server = createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>"
        );
        codeReject(
          new Error(
            `Authorization failed: ${error} — ${url.searchParams.get("error_description") ?? ""}`
          )
        );
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Missing code</h1></body></html>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h1>Authentication successful!</h1><p>You can close this tab.</p></body></html>"
      );
      codeResolve(code);
    });

    const timer = setTimeout(() => {
      codeReject(
        new Error(
          "Browser authentication timed out — no callback received within 2 minutes"
        )
      );
      server.close();
    }, CALLBACK_TIMEOUT_MS);
    timer.unref();

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start callback server"));
        return;
      }

      resolve({
        port: addr.port,
        close: () => {
          clearTimeout(timer);
          server.close();
        },
        waitForCode,
      });
    });

    server.on("error", reject);
  });
}

function openBrowser(url: string): void {
  const os = platform();
  const commands: Record<string, string> = {
    darwin: "open",
    linux: "xdg-open",
    win32: "start",
  };
  const cmd = commands[os];
  if (!cmd) {
    console.error(
      `[auth] Cannot auto-open browser on ${os}. Open this URL manually:\n${url}`
    );
    return;
  }

  execFile(cmd, [url], (error) => {
    if (error) {
      console.error(
        `[auth] Failed to open browser. Open this URL manually:\n${url}`
      );
    }
  });
}
