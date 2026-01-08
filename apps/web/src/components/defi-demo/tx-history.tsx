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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { trpcReact } from "@/lib/trpc/client";

interface TxHistoryProps {
  networkId: string;
  walletAddress: string;
  onMintClick?: () => void;
}

interface Transfer {
  txHash: string;
  type: string;
  blockNumber: number;
  from: string;
  to: string;
  amount?: string;
}

interface TxHistoryData {
  transfers: Transfer[];
  demo?: boolean;
}

function TxDetailLine({
  tx,
  formatAddress,
}: {
  tx: Transfer;
  formatAddress: (address: string) => string;
}) {
  if (tx.type === "transfer_out") {
    return <>To: {formatAddress(tx.to)}</>;
  }
  if (tx.type === "transfer_in") {
    return <>From: {formatAddress(tx.from)}</>;
  }
  if (tx.type === "mint" && tx.amount) {
    return (
      <>
        Amount: {(BigInt(tx.amount) / BigInt(10 ** 18)).toLocaleString()} tokens
      </>
    );
  }
  return null;
}

function TxHistoryContent({
  isLoading,
  error,
  data,
  getTypeIcon,
  getTypeLabel,
  formatAddress,
  onMintClick,
}: {
  isLoading: boolean;
  error: unknown;
  data: TxHistoryData | undefined;
  getTypeIcon: (type: string) => React.ReactNode;
  getTypeLabel: (type: string) => string;
  formatAddress: (address: string) => string;
  onMintClick?: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-4 text-center text-muted-foreground text-sm">
        Failed to load history
      </p>
    );
  }

  if (!data?.transfers || data.transfers.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>No Transactions Yet</EmptyTitle>
          <EmptyDescription>
            Mint or transfer tokens to see your history here.
          </EmptyDescription>
        </EmptyHeader>
        {onMintClick ? (
          <EmptyContent>
            <Button onClick={onMintClick} size="sm" variant="outline">
              <Coins className="mr-2 h-4 w-4" />
              Mint Tokens
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {data.transfers.map((tx, index) => (
        <div
          className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
          key={`${tx.txHash}-${index}`}
        >
          <div className="flex items-center gap-3">
            {getTypeIcon(tx.type)}
            <div>
              <div className="flex items-center gap-2">
                <Badge className="text-xs" variant="outline">
                  {getTypeLabel(tx.type)}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  Block #{tx.blockNumber}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground text-xs">
                <TxDetailLine formatAddress={formatAddress} tx={tx} />
              </p>
            </div>
          </div>
          <a
            aria-label="View transaction on Etherscan"
            className="text-muted-foreground transition-colors hover:text-foreground"
            href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
            rel="noopener noreferrer"
            target="_blank"
            title="View on Explorer"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      ))}

      {data.demo ? (
        <p className="pt-2 text-center text-warning text-xs">
          Demo mode - showing mock data
        </p>
      ) : null}
    </div>
  );
}

export function TxHistory({
  networkId,
  walletAddress,
  onMintClick,
}: TxHistoryProps) {
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
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
        <TxHistoryContent
          data={data}
          error={error}
          formatAddress={formatAddress}
          getTypeIcon={getTypeIcon}
          getTypeLabel={getTypeLabel}
          isLoading={isLoading}
          onMintClick={onMintClick}
        />
      </CardContent>
    </Card>
  );
}
