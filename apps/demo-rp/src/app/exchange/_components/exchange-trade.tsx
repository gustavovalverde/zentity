"use client";

import { AlertCircleIcon, Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ExchangeTradeProps {
  isVerified: boolean;
  onStepUp: () => void;
}

export function ExchangeTrade({ isVerified, onStepUp }: ExchangeTradeProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");

  if (!isVerified) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-8">
        <Card className="border-primary/30">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon
                className="text-primary"
                icon={AlertCircleIcon}
                size={32}
              />
            </div>
            <h3 className="font-semibold text-lg">Limited Access</h3>
            <p className="mt-2 text-muted-foreground text-sm">
              MiCA requires crypto-asset service providers to verify customer
              nationality for sanctions compliance. Zentity proves nationality
              through a zero-knowledge proof. No passport image or document
              number is shared.
            </p>
            <div className="mt-4">
              <Badge className="font-mono text-xs" variant="outline">
                identity.nationality
              </Badge>
            </div>
            <Button className="mt-6 w-full gap-2" onClick={onStepUp} size="lg">
              <HugeiconsIcon icon={Shield01Icon} size={16} />
              Verify to Start Trading
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Trade</CardTitle>
            <Badge className="bg-success text-white">Verified</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex rounded-lg bg-secondary p-1">
            {(["buy", "sell"] as const).map((s) => (
              <button
                className={`flex-1 rounded-md py-2 font-medium text-sm capitalize transition-colors ${
                  side === s
                    ? s === "buy"
                      ? "bg-success text-white"
                      : "bg-destructive text-white"
                    : "text-muted-foreground"
                }`}
                key={s}
                onClick={() => setSide(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1.5 block text-muted-foreground text-sm">
              Asset
            </label>
            <div className="flex items-center gap-2 rounded-lg border bg-secondary px-3 py-2.5">
              <div className="flex size-6 items-center justify-center rounded-full bg-primary font-bold font-mono text-primary-foreground text-xs">
                B
              </div>
              <span className="font-medium text-sm">Bitcoin (BTC)</span>
              <span className="ml-auto font-mono text-muted-foreground text-sm">
                $97,432.50
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-muted-foreground text-sm">
              Amount (USD)
            </label>
            <input
              className="w-full rounded-lg border bg-secondary px-3 py-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              type="text"
              value={amount}
            />
          </div>

          {amount && Number(amount) > 0 && (
            <div className="rounded-lg bg-secondary p-3 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>You {side === "buy" ? "receive" : "sell"}</span>
                <span className="font-mono">
                  ~{(Number(amount) / 97_432.5).toFixed(6)} BTC
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Fee</span>
                <span className="font-mono">
                  ${(Number(amount) * 0.001).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <Button
            className="w-full"
            disabled={!amount || Number(amount) <= 0}
            size="lg"
          >
            {side === "buy" ? "Buy" : "Sell"} Bitcoin
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
