import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { platform } from "node:os";
import type { TokenResult } from "../fpa/oauth.js";
import type { PkceChallenge } from "../fpa/pkce.js";
import type { DpopClient } from "../rp/dpop-client.js";

const DEFAULT_CALLBACK_TIMEOUT_MS = 120_000;

type MaybePromise<T> = Promise<T> | T;

export interface AuthenticateWithLoopbackBrowserOptions {
  authorizeEndpoint: string;
  clientId: string;
  dpopClient: DpopClient;
  exchangeAuthorizationCode(input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }): Promise<TokenResult>;
  openUrl?: (url: string) => MaybePromise<void>;
  parEndpoint?: string;
  pkce: PkceChallenge;
  resource?: string;
  scope: string;
  timeoutMs?: number;
}

interface CallbackServer {
  close(): void;
  port: number;
  waitForCode: Promise<string>;
}

async function pushAuthorizationRequest(
  options: AuthenticateWithLoopbackBrowserOptions,
  redirectUri: string
): Promise<string> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: options.scope,
    code_challenge: options.pkce.codeChallenge,
    code_challenge_method: options.pkce.codeChallengeMethod,
  });
  if (options.resource) {
    body.set("resource", options.resource);
  }

  const { response } = await options.dpopClient.withNonceRetry(
    async (nonce) => {
      const proof = await options.dpopClient.proofFor(
        "POST",
        options.parEndpoint as string,
        undefined,
        nonce
      );
      const response = await fetch(options.parEndpoint as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: proof,
        },
        body,
      });
      return { response, result: undefined };
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`PAR request failed: ${response.status} ${message}`);
  }

  const responseBody = (await response.json()) as {
    request_uri?: unknown;
  };
  if (
    typeof responseBody.request_uri !== "string" ||
    responseBody.request_uri.length === 0
  ) {
    throw new Error("PAR response missing request_uri");
  }

  const authorizeUrl = new URL(options.authorizeEndpoint);
  authorizeUrl.searchParams.set("client_id", options.clientId);
  authorizeUrl.searchParams.set("request_uri", responseBody.request_uri);
  return authorizeUrl.toString();
}

function buildAuthorizeUrl(
  options: AuthenticateWithLoopbackBrowserOptions,
  redirectUri: string
): string {
  const authorizeUrl = new URL(options.authorizeEndpoint);
  authorizeUrl.searchParams.set("client_id", options.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", options.scope);
  authorizeUrl.searchParams.set("code_challenge", options.pkce.codeChallenge);
  authorizeUrl.searchParams.set(
    "code_challenge_method",
    options.pkce.codeChallengeMethod
  );
  if (options.resource) {
    authorizeUrl.searchParams.set("resource", options.resource);
  }

  return authorizeUrl.toString();
}

function startCallbackServer(timeoutMs: number): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;

    const waitForCode = new Promise<string>((resolvePromise, rejectPromise) => {
      resolveCode = resolvePromise;
      rejectCode = rejectPromise;
    });

    const server = createServer((request, response) => {
      if (!request.url?.startsWith("/callback")) {
        response.writeHead(404);
        response.end();
        return;
      }

      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const authorizationCode = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          "<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>"
        );
        rejectCode(
          new Error(
            `Authorization failed: ${error} — ${requestUrl.searchParams.get("error_description") ?? ""}`
          )
        );
        return;
      }

      if (!authorizationCode) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end("<html><body><h1>Missing code</h1></body></html>");
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        "<html><body><h1>Authentication successful!</h1><p>You can close this tab.</p></body></html>"
      );
      resolveCode(authorizationCode);
    });

    const timer = setTimeout(() => {
      rejectCode(
        new Error(
          "Browser authentication timed out — no callback received before the deadline"
        )
      );
      server.close();
    }, timeoutMs);
    timer.unref?.();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start callback server"));
        return;
      }

      resolve({
        close() {
          clearTimeout(timer);
          server.close();
        },
        port: address.port,
        waitForCode,
      });
    });

    server.on("error", reject);
  });
}

const OPEN_URL_COMMANDS: Record<
  NodeJS.Platform,
  (url: string) => { command: string; args: string[] } | undefined
> = {
  aix: () => undefined,
  android: () => undefined,
  cygwin: () => undefined,
  darwin: (url) => ({ command: "open", args: [url] }),
  freebsd: () => undefined,
  haiku: () => undefined,
  linux: (url) => ({ command: "xdg-open", args: [url] }),
  netbsd: () => undefined,
  openbsd: () => undefined,
  sunos: () => undefined,
  win32: (url) => ({ command: "cmd", args: ["/c", "start", "", url] }),
};

function openUrlWithPlatformDefault(url: string): void {
  const os = platform();
  const command = OPEN_URL_COMMANDS[os]?.(url);
  if (!command) {
    console.error(
      `[auth] Cannot auto-open browser on ${os}. Open this URL manually:\n${url}`
    );
    return;
  }

  execFile(command.command, command.args, (error) => {
    if (error) {
      console.error(
        `[auth] Failed to open browser automatically. Open this URL manually:\n${url}`
      );
    }
  });
}

export async function authenticateWithLoopbackBrowser(
  options: AuthenticateWithLoopbackBrowserOptions
): Promise<TokenResult> {
  const callbackServer = await startCallbackServer(
    options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
  );
  const redirectUri = `http://127.0.0.1:${callbackServer.port}/callback`;

  try {
    const authorizeUrl = options.parEndpoint
      ? await pushAuthorizationRequest(options, redirectUri)
      : buildAuthorizeUrl(options, redirectUri);

    await (options.openUrl ?? openUrlWithPlatformDefault)(authorizeUrl);
    const authorizationCode = await callbackServer.waitForCode;

    return options.exchangeAuthorizationCode({
      clientId: options.clientId,
      code: authorizationCode,
      codeVerifier: options.pkce.codeVerifier,
      redirectUri,
      ...(options.resource ? { resource: options.resource } : {}),
    });
  } finally {
    callbackServer.close();
  }
}
