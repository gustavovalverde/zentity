// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const LINK_WORLD_ID_BUTTON_NAME = /link world id/i;
const REMOVE_BUTTON_NAME = /remove/i;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

import { WorldIdLink } from "../world-id-link";

describe("WorldIdLink", () => {
  it("shows the link action when no World ID credential is linked", () => {
    render(<WorldIdLink linked={false} userId="user-test" />);

    expect(
      screen.getByRole("button", { name: LINK_WORLD_ID_BUTTON_NAME })
    ).toBeTruthy();
  });

  it("shows the linked status and remove action when World ID is linked", () => {
    render(<WorldIdLink linked={true} userId="user-test" />);

    expect(screen.getByText("World ID Linked")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: REMOVE_BUTTON_NAME })
    ).toBeTruthy();
  });
});
