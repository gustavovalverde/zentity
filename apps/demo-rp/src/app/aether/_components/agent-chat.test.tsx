import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SHOPPING_TASKS } from "@/data/aether";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz" },
}));

import { AgentChat } from "./agent-chat";

const TOKEN_DETAILS = /token details/i;
const UTF8_NAME_CLAIM = /"name": "José Müller"/;

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "EdDSA" })}.${encode(payload)}.signature`;
}

describe("AgentChat", () => {
  it("shows non-ASCII id_token claims as UTF-8", () => {
    const task = SHOPPING_TASKS[0];
    if (!task) {
      throw new Error("missing Aether shopping task");
    }

    render(
      <AgentChat
        cibaState="approved"
        error={null}
        onReset={vi.fn()}
        onTriggerCiba={vi.fn()}
        preparationError={null}
        prepared={null}
        task={task}
        tokens={{
          id_token: unsignedJwt({ sub: "pairwise-sub", name: "José Müller" }),
        }}
        userInfo={null}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: TOKEN_DETAILS }));

    expect(screen.getByText(UTF8_NAME_CLAIM)).toBeTruthy();
  });
});
