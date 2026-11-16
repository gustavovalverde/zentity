// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(
  async (_input: unknown): Promise<Record<string, unknown>> => ({
    offerUri: "openid-credential-offer://?credential_offer=%7B%7D",
    offer: {},
    expiresIn: 300,
  })
);

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

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
    toastError.mockClear();
  });
  afterEach(cleanup);

  function openWalletPicker() {
    fireEvent.click(
      screen.getByRole("button", { name: "Use a registered wallet" })
    );
  }

  it("offers the credential to the built-in wallet by default", async () => {
    render(<CredentialsSection />);

    await getCredential();

    expect(mutateAsync).toHaveBeenCalledWith({});
  });

  it("offers the credential to the registered wallet the user names", async () => {
    render(<CredentialsSection />);

    openWalletPicker();
    fireEvent.change(screen.getByLabelText("Wallet client ID"), {
      target: { value: "  wallet-123 " },
    });
    await getCredential();

    expect(mutateAsync).toHaveBeenCalledWith({ walletClientId: "wallet-123" });
    expect(screen.getByText("wallet-123")).toBeTruthy();
  });

  it("offers to the built-in wallet again once the registered wallet field is collapsed", async () => {
    render(<CredentialsSection />);

    openWalletPicker();
    fireEvent.change(screen.getByLabelText("Wallet client ID"), {
      target: { value: "wallet-123" },
    });
    openWalletPicker();
    await getCredential();

    expect(mutateAsync).toHaveBeenCalledWith({});
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByText("Scan with Your Wallet")).toBeNull()
    );
    openWalletPicker();
    expect(
      (screen.getByLabelText("Wallet client ID") as HTMLInputElement).value
    ).toBe("");
  });

  it("shows a refused wallet client ID next to the field", async () => {
    const refusal = Object.assign(
      new Error("No wallet with this client ID can receive credentials."),
      { data: { code: "BAD_REQUEST" } }
    );
    mutateAsync.mockRejectedValueOnce(refusal);
    render(<CredentialsSection />);

    openWalletPicker();
    const field = screen.getByLabelText("Wallet client ID");
    fireEvent.change(field, { target: { value: "does-not-exist" } });
    fireEvent.click(screen.getByRole("button", { name: "Get Credential" }));

    const message = "No wallet with this client ID can receive credentials.";
    expect((await screen.findByText(message)).getAttribute("role")).toBe(
      "alert"
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(toastError).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "wallet-123" } });
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
  });
});
