// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TxDetailLine } from "./tx-history";

const formatAddress = (address: string) => address;

describe("TxDetailLine", () => {
  it("shows the fractional part of a minted amount", () => {
    render(
      <TxDetailLine
        formatAddress={formatAddress}
        tx={{
          amount: "1500000000000000000",
          blockNumber: 1,
          from: "0x0",
          to: "0x0",
          txHash: "0x1",
          type: "mint",
        }}
      />
    );

    expect(screen.getByText("Amount: 1.5 tokens")).toBeTruthy();
  });
});
