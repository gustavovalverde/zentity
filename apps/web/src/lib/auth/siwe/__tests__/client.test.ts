import { describe, expect, it, vi } from "vitest";

import { siweAuthClient } from "../client";

const WALLET_NONDETERMINISTIC_ERROR = /wallet_nondeterministic/i;
const ADDRESS = "0x0000000000000000000000000000000000000001";
const MESSAGE =
  "localhost:3000 wants you to sign in with your Ethereum account";

interface BetterFetchResponse<T> {
  data: T | null;
  error: {
    message?: string;
    code?: string;
  } | null;
}

type FetchMock = (
  path: string,
  options?: Record<string, unknown>
) => Promise<BetterFetchResponse<unknown>>;

function createActions(fetchMock: FetchMock) {
  return siweAuthClient().getActions(
    fetchMock as unknown as <T>(
      path: string,
      options?: Record<string, unknown>
    ) => Promise<BetterFetchResponse<T>>
  );
}

function respondWith(routes: Record<string, unknown>) {
  return vi.fn<FetchMock>((path) =>
    Promise.resolve(
      path in routes
        ? { data: routes[path], error: null }
        : { data: null, error: { message: "unexpected path" } }
    )
  );
}

describe("siweAuthClient signUp determinism", () => {
  it("blocks registration when signatures are non-deterministic", async () => {
    const fetchMock = respondWith({
      "/sign-up/siwe/challenge": { message: MESSAGE },
    });
    const signMessage = vi
      .fn<(message: string) => Promise<string>>()
      .mockResolvedValueOnce("0xaaa")
      .mockResolvedValueOnce("0xbbb");

    await expect(
      createActions(fetchMock).signUp.siwe({
        address: ADDRESS,
        chainId: 1,
        signMessage,
      })
    ).rejects.toThrow(WALLET_NONDETERMINISTIC_ERROR);

    expect(signMessage).toHaveBeenCalledTimes(2);
    expect(signMessage).toHaveBeenCalledWith(MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/sign-up/siwe/challenge",
      expect.objectContaining({
        method: "POST",
        body: { address: ADDRESS, chainId: 1 },
      })
    );
  });

  it("registers with the signed message and both identical signatures", async () => {
    const fetchMock = respondWith({
      "/sign-up/siwe/challenge": { message: MESSAGE },
      "/sign-up/siwe/complete": { token: "token-1", user: { id: "user-1" } },
    });
    const signMessage = vi
      .fn<(message: string) => Promise<string>>()
      .mockResolvedValue("0xsame");

    const result = await createActions(fetchMock).signUp.siwe({
      address: ADDRESS,
      chainId: 1,
      signMessage,
    });

    expect(result).toEqual({ token: "token-1", user: { id: "user-1" } });
    expect(signMessage).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/sign-up/siwe/complete", {
      method: "POST",
      body: { message: MESSAGE, signature: "0xsame", signature2: "0xsame" },
    });
  });
});

describe("siweAuthClient signIn", () => {
  it("signs the server's message once and submits it with the signature", async () => {
    const fetchMock = respondWith({
      "/sign-in/siwe/challenge": { message: MESSAGE },
      "/sign-in/siwe/complete": { token: "token-1", user: { id: "user-1" } },
    });
    const signMessage = vi
      .fn<(message: string) => Promise<string>>()
      .mockResolvedValue("0xsig");

    const result = await createActions(fetchMock).signIn.siwe({
      address: ADDRESS,
      chainId: 1,
      signMessage,
    });

    expect(result).toEqual({ token: "token-1", user: { id: "user-1" } });
    expect(signMessage).toHaveBeenCalledExactlyOnceWith(MESSAGE);
    expect(fetchMock).toHaveBeenLastCalledWith("/sign-in/siwe/complete", {
      method: "POST",
      body: { message: MESSAGE, signature: "0xsig" },
    });
  });
});

describe("siweAuthClient verifyWallet", () => {
  it("confirms the wallet in the current session with one signature", async () => {
    const fetchMock = respondWith({
      "/wallet/siwe/verify/challenge": { message: MESSAGE },
      "/wallet/siwe/verify/complete": { success: true },
    });
    const signMessage = vi
      .fn<(message: string) => Promise<string>>()
      .mockResolvedValue("0xsig");

    const result = await createActions(fetchMock).siwe.verifyWallet({
      address: ADDRESS,
      chainId: 1,
      signMessage,
    });

    expect(result).toEqual({ success: true });
    expect(signMessage).toHaveBeenCalledExactlyOnceWith(MESSAGE);
    expect(fetchMock).toHaveBeenLastCalledWith("/wallet/siwe/verify/complete", {
      method: "POST",
      body: { message: MESSAGE, signature: "0xsig" },
    });
  });

  it("asks for no signature when the server refuses the wallet", async () => {
    const fetchMock = vi.fn<FetchMock>(() =>
      Promise.resolve({
        data: null,
        error: { message: "This wallet isn't linked to your account." },
      })
    );
    const signMessage = vi.fn<(message: string) => Promise<string>>();

    await expect(
      createActions(fetchMock).siwe.verifyWallet({
        address: ADDRESS,
        chainId: 1,
        signMessage,
      })
    ).rejects.toThrow("This wallet isn't linked to your account.");
    expect(signMessage).not.toHaveBeenCalled();
  });
});
