// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async (_input: unknown) => ({
  offerUri: "openid-credential-offer://?credential_offer=%7B%7D",
  offer: {},
  expiresIn: 300,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isLoading: false,
    error: null,
    data: {
      verified: true,
      level: "full",
      checks: {},
      humanityProven: false,
      verifiedClaims: ["verified"],
    },
  }),
  useMutation: () => ({ isPending: false, mutateAsync }),
}));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    credentials: {
      status: { queryOptions: () => ({}) },
      createOffer: { mutationOptions: () => ({}) },
    },
  }),
}));

vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));

import { CredentialsSection } from "./credentials-section";

async function getCredential() {
  fireEvent.click(screen.getByRole("button", { name: "Get Credential" }));
  await screen.findByText("Scan with Your Wallet");
}

describe("CredentialsSection", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });

  it("offers the credential to the built-in wallet by default", async () => {
    render(<CredentialsSection />);

    await getCredential();

    expect(mutateAsync).toHaveBeenCalledWith({});
  });

  it("offers the credential to the registered wallet the user names", async () => {
    render(<CredentialsSection />);

    fireEvent.click(
      screen.getByRole("button", { name: "Use a registered wallet" })
    );
    fireEvent.change(screen.getByLabelText("Wallet client ID"), {
      target: { value: "  wallet-123 " },
    });
    await getCredential();

    expect(mutateAsync).toHaveBeenCalledWith({ walletClientId: "wallet-123" });
  });
});
