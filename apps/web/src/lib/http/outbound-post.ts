import "server-only";

import type { LookupAddress } from "node:dns";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  isPermittedDestination,
  validateOutboundUrl,
} from "@/lib/http/url-safety";

const DEFAULT_TIMEOUT_MS = 10_000;
const IPV6_BRACKETS_REGEX = /^\[|\]$/g;

type VettedAddresses = [LookupAddress, ...LookupAddress[]];

async function resolveDestination(url: URL): Promise<VettedAddresses> {
  const hostname = url.hostname.replace(IPV6_BRACKETS_REGEX, "");
  const family = isIP(hostname);
  const addresses =
    family === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family }];

  const [first, ...rest] = addresses;
  if (
    !first ||
    addresses.some(({ address }) => !isPermittedDestination(url, address))
  ) {
    throw new Error(
      `${url.origin} must not resolve to a private or reserved address`
    );
  }
  return [first, ...rest];
}

/**
 * POST to a client-registered URL and return the response status.
 *
 * The URL is validated, its hostname is resolved once, and every answer must
 * be a permitted destination. The connection is pinned to the vetted addresses
 * while the hostname stays the Host header and TLS identity. Redirects are
 * returned, never followed, and the response body is never read.
 */
export async function postToPublicUrl(
  target: string,
  init: {
    body: string;
    headers: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<number> {
  const problem = validateOutboundUrl(target);
  if (problem) {
    throw new Error(`Destination URL ${problem}`);
  }

  const url = new URL(target);
  const vetted = await resolveDestination(url);
  const [first] = vetted;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise<number>((resolve, reject) => {
    const request = send(
      url,
      {
        agent: false,
        method: "POST",
        headers: {
          ...init.headers,
          "Content-Length": String(Buffer.byteLength(init.body)),
        },
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, vetted);
          } else {
            callback(null, first.address, first.family);
          }
        },
      },
      (response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      }
    );
    request.once("error", reject);
    request.end(init.body);
  });
}
