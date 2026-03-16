import type { NextRequest } from "next/server";

import { proxy, config as proxyConfig } from "./proxy";

export function middleware(request: NextRequest) {
  return proxy(request);
}

export const config = proxyConfig;
