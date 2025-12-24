"use client";

/**
 * Transaction History Component
 *
 * Displays recent token transfer and mint events for the user.
 */
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  ExternalLink,
  History,
  Loader2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpcReact } from "@/lib/trpc/client";

interface TxHistoryProps {
  networkId: string;
  walletAddress: string;
}

export function TxHistory({ networkId, walletAddress }: TxHistoryProps) {
  const { data, isLoading, error } = trpcReact.token.history.useQuery({
    networkId,
    walletAddress,
    limit: 10,
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "mint":
        return <Coins className="h-4 w-4 text-success" />;
      case "transfer_in":
        return <ArrowDownLeft className="h-4 w-4 text-info" />;
      case "transfer_out":
        return <ArrowUpRight className="h-4 w-4 text-warning" />;
      default:
        return <History className="h-4 w-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "mint":
        return "Mint";
      case "transfer_in":
        return "Received";
      case "transfer_out":
        return "Sent";
      default:
        return "Unknown";
    }
  };

  const formatAddress = (address: string) => {
    if (address === "0x0000000000000000000000000000000000000000") {
      return "Contract";
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Transaction History</CardTitle>
        </div>
        <CardDescription>Recent token events for your wallet</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Failed to load history
          </p>
        ) : !data?.transfers || data.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No transactions yet
          </p>
        ) : (
          <div className="space-y-3">
            {data.transfers.map((tx, index) => (
              <div
                key={`${tx.txHash}-${index}`}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  {getTypeIcon(tx.type)}
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {getTypeLabel(tx.type)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Block #{tx.blockNumber}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tx.type === "transfer_out" ? (
                        <>To: {formatAddress(tx.to)}</>
                      ) : tx.type === "transfer_in" ? (
                        <>From: {formatAddress(tx.from)}</>
                      ) : tx.type === "mint" && "amount" in tx && tx.amount ? (
                        <>
                          Amount:{" "}
                          {(
                            BigInt(tx.amount) / BigInt(10 ** 18)
                          ).toLocaleString()}{" "}
                          tokens
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                <a
                  href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="View on Explorer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            ))}

            {data.demo && (
              <p className="text-xs text-center text-warning pt-2">
                Demo mode - showing mock data
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
