import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { POST: authPOST } = toNextJsHandler(auth);

export function POST(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);

  return authPOST(request);
}
