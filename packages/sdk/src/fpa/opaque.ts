import opaque from "@serenity-kit/opaque";

export interface OpaqueStartResult {
  clientLoginState: string;
  startLoginRequest: string;
}

export interface OpaqueFinishResult {
  exportKey: string;
  finishLoginRequest: string;
  serverStaticPublicKey: string;
}

export async function ensureOpaqueReady(): Promise<void> {
  await opaque.ready;
}

export function startOpaqueLogin(password: string): OpaqueStartResult {
  return opaque.client.startLogin({ password });
}

export function finishOpaqueLogin(
  clientLoginState: string,
  loginResponse: string,
  password: string
): OpaqueFinishResult | undefined {
  return opaque.client.finishLogin({
    clientLoginState,
    loginResponse,
    password,
  });
}
