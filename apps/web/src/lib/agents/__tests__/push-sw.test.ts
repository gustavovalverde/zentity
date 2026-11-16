import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKER_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../../public/push-sw.js"),
  "utf8"
);

type Listener = (event: Record<string, unknown>) => void;

/** Loads the worker into a fake ServiceWorkerGlobalScope. */
function loadWorker(fetchResponse: { ok: boolean } = { ok: true }) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve());
  const fetch = vi.fn(() => Promise.resolve(fetchResponse));
  const self = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener);
    },
    registration: { showNotification },
    clients: { matchAll: () => Promise.resolve([]), openWindow },
  };
  runInNewContext(WORKER_SOURCE, {
    self,
    fetch,
    caches: { keys: () => Promise.resolve([]) },
    URL,
    JSON,
    Promise,
  });

  async function dispatch(type: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  }

  return {
    fetch,
    openWindow,
    showNotification,
    async push(data: Record<string, unknown>) {
      await dispatch("push", {
        data: { json: () => ({ title: "Request", body: "Body", data }) },
      });
      const [, options] = showNotification.mock.calls.at(-1) as unknown as [
        string,
        { actions: { action: string }[]; data: Record<string, unknown> },
      ];
      return options;
    },
    click(action: string, data: Record<string, unknown>) {
      return dispatch("notificationclick", {
        action,
        notification: { close: () => undefined, data },
      });
    },
  };
}

const APPROVAL_URL = "https://app.zentity.xyz/approve/req-1";

function actionsOf(options: { actions: { action: string }[] }) {
  return options.actions.map((entry) => entry.action);
}

// R1: the worker offers Approve only for requests the server marks inline.
describe("push service worker", () => {
  let worker: ReturnType<typeof loadWorker>;

  beforeEach(() => {
    worker = loadWorker();
  });

  it("offers Approve and Deny for an inline request", async () => {
    const options = await worker.push({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: true,
      requiresVaultUnlock: false,
    });

    expect(actionsOf(options)).toEqual(["approve", "deny"]);
  });

  it.each([
    ["absent", {}],
    ["false", { inlineApprove: false }],
    ["a string", { inlineApprove: "true" }],
  ])("offers Review and Deny when inlineApprove is %s", async (_case, flag) => {
    const options = await worker.push({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      ...flag,
    });

    expect(actionsOf(options)).toEqual(["review", "deny"]);
  });

  it("offers only Deny for an identity request, even if marked inline", async () => {
    const options = await worker.push({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: true,
      requiresVaultUnlock: true,
    });

    expect(actionsOf(options)).toEqual(["deny"]);
  });

  it("posts an inline approval with the push channel", async () => {
    await worker.click("approve", {
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: true,
    });

    expect(worker.fetch).toHaveBeenCalledTimes(1);
    const [, init] = worker.fetch.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({
      request_id: "req-1",
      decision: "approved",
      channel: "push",
    });
  });

  it("opens the approval page instead of approving a page-only request", async () => {
    await worker.click("approve", {
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: false,
    });

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.openWindow).toHaveBeenCalledWith(APPROVAL_URL);
  });

  it("opens the approval page when the server refuses an inline approval", async () => {
    worker = loadWorker({ ok: false });

    await worker.click("approve", {
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: true,
    });

    expect(worker.openWindow).toHaveBeenCalledWith(APPROVAL_URL);
  });

  it("keeps the two-step confirmation for payments", async () => {
    const options = await worker.push({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      inlineApprove: false,
      kind: "payment_authorization",
      payment: { amountDisplay: "1 ZEC", chain: "zcash:test" },
    });
    expect(actionsOf(options)).toEqual(["review", "deny"]);

    await worker.click("review", options.data);

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.showNotification).toHaveBeenLastCalledWith(
      "Confirm payment",
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "payment_authorization_confirm",
        }),
      })
    );
  });
});
