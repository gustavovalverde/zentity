import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth-config";
import {
  persistDcrClientExtensions,
  readDcrClientExtensions,
} from "@/lib/auth/oidc/dcr-client-extensions";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { POST: authPOST } = toNextJsHandler(auth);

export async function POST(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);

  const requestBody = (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  const response = await authPOST(request);

  if (!response.ok) {
    return response;
  }

  const extensions = readDcrClientExtensions(requestBody);
  if (!extensions) {
    return response;
  }

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { client_id?: unknown } | null;
  if (typeof payload?.client_id !== "string") {
    return response;
  }

  await persistDcrClientExtensions(payload.client_id, extensions);
  return response;
}
