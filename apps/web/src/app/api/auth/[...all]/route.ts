import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";
import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";

const { GET: authGET, POST: authPOST } = toNextJsHandler(auth);

export async function GET(request: Request) {
  const requestContext = await resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  return authGET(request);
}

export async function POST(request: Request) {
  const requestContext = await resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  return authPOST(request);
}
