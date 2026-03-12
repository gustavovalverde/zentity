import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthContext {
  accessToken: string;
  clientId: string;
  loginHint: string;
}

const authStorage = new AsyncLocalStorage<AuthContext>();

export function runWithAuth<T>(ctx: AuthContext, fn: () => T): T {
  return authStorage.run(ctx, fn);
}

export function getAuthContext(): AuthContext {
  const ctx = authStorage.getStore();
  if (!ctx) {
    throw new Error(
      "No auth context — tool called outside authenticated scope"
    );
  }
  return ctx;
}
