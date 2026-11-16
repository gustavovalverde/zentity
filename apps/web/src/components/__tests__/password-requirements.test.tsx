// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordRequirements } from "@/components/password-requirements";

const pwnedMocks = vi.hoisted(() => ({
  checkPasswordPwned: vi.fn(),
}));

vi.mock("@/lib/auth/password", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/password")>()),
  checkPasswordPwned: pwnedMocks.checkPasswordPwned,
}));

const PASSWORD = "correct-horse-battery-staple-1!";
const BREACH_CHECK_TIMEOUT_MS = 6000;
const BREACH_CHECK_ERROR_TEXT = /Couldn't check breaches right now/;

function hangUntilAborted(
  _password: string,
  opts?: { signal?: AbortSignal }
): Promise<never> {
  return new Promise((_resolve, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(opts.signal?.reason), {
      once: true,
    });
  });
}

describe("PasswordRequirements breach check", () => {
  beforeEach(() => {
    pwnedMocks.checkPasswordPwned.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports an error when the breach check times out", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    pwnedMocks.checkPasswordPwned.mockImplementation(hangUntilAborted);
    const onBreachStatusChange = vi.fn();

    render(
      <PasswordRequirements
        breachCheckKey={1}
        onBreachStatusChange={onBreachStatusChange}
        password={PASSWORD}
      />
    );

    await screen.findByText("Checking known breaches…");
    expect(timeoutSpy).toHaveBeenCalledWith(BREACH_CHECK_TIMEOUT_MS);
    expect(onBreachStatusChange).not.toHaveBeenCalledWith("error", null);

    timeout.abort(new DOMException("timed out", "TimeoutError"));

    await screen.findByText(BREACH_CHECK_ERROR_TEXT);
    expect(onBreachStatusChange).toHaveBeenLastCalledWith("error", null);
  });

  it("aborts the request without reporting an error when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    pwnedMocks.checkPasswordPwned.mockImplementation(
      (password: string, opts?: { signal?: AbortSignal }) => {
        requestSignal = opts?.signal;
        return hangUntilAborted(password, opts);
      }
    );
    const onBreachStatusChange = vi.fn();

    const { unmount } = render(
      <PasswordRequirements
        breachCheckKey={1}
        onBreachStatusChange={onBreachStatusChange}
        password={PASSWORD}
      />
    );
    await waitFor(() => expect(requestSignal).toBeDefined());
    expect(requestSignal?.aborted).toBe(false);

    unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(onBreachStatusChange).not.toHaveBeenCalledWith("error", null);
  });

  it("shows the safe state when the check completes", async () => {
    pwnedMocks.checkPasswordPwned.mockResolvedValue({
      compromised: false,
      skipped: false,
    });

    render(<PasswordRequirements breachCheckKey={1} password={PASSWORD} />);

    await screen.findByText("Not found in known breaches");
  });
});
