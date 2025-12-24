/**
 * Token Router
 *
 * Handles CompliantERC20 token operations for the DeFi compliance demo.
 * Supports server-side minting and read operations.
 *
 * Key flows:
 * - Get token info (name, symbol, decimals, totalSupply)
 * - Mint tokens to attested users (server-side, owner-only)
 * - Check attestation status for addresses
 * - Get transfer event history
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { hardhat, sepolia } from "viem/chains";
import { z } from "zod";

import {
  canCreateProvider,
  createProvider,
  getEnabledNetworks,
  getNetworkById,
  isDemoMode,
} from "@/lib/blockchain";
import { CompliantERC20ABI } from "@/lib/contracts";
import {
  getBlockchainAttestationByUserAndNetwork,
  getVerificationStatus,
} from "@/lib/db";

import { protectedProcedure, router } from "../server";

// Chain configurations for viem
const VIEM_CHAINS = {
  11155111: sepolia,
  31337: hardhat,
} as const;

// CompliantERC20 ABI (kept in sync with contracts package)
const COMPLIANT_ERC20_ABI = CompliantERC20ABI;

// Rate limiting for mint requests
const MINT_RATE_LIMIT_MAX = 3;
const MINT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
// Note: Contract uses euint64 for balances with 18 decimals.
// uint64.max = ~18.4 * 10^18, so max total supply is ~18 tokens.
// We limit per-mint to 10 tokens to allow multiple mints before hitting cap.
const MAX_MINT_AMOUNT = BigInt(10) * BigInt(10) ** BigInt(18); // 10 tokens

const mintAttemptTracker = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkMintRateLimit(userId: string, networkId: string): boolean {
  const key = `${userId}:${networkId}:mint`;
  const now = Date.now();
  const entry = mintAttemptTracker.get(key);

  if (!entry || now > entry.resetAt) {
    mintAttemptTracker.set(key, {
      count: 1,
      resetAt: now + MINT_RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= MINT_RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

export const tokenRouter = router({
  /**
   * Get token contract info for a network.
   */
  info: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .query(async ({ input }) => {
      // Demo mode: return mock data
      if (isDemoMode()) {
        return {
          name: "Zentity Token",
          symbol: "ZTY",
          decimals: 18,
          totalSupply: "100000000000000000000000", // 100,000 tokens
          contractAddress: "0xDEMO000000000000000000000000000000000003",
          demo: true,
        };
      }

      const network = getNetworkById(input.networkId);
      if (!network || !network.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const contractAddress = network.contracts.compliantERC20;
      if (!contractAddress) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `CompliantERC20 not deployed on ${input.networkId}`,
        });
      }

      const chain = VIEM_CHAINS[network.chainId as keyof typeof VIEM_CHAINS];
      if (!chain) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unsupported chain ID: ${network.chainId}`,
        });
      }

      const client = createPublicClient({
        chain,
        transport: http(network.rpcUrl),
      });

      try {
        const [name, symbol, decimals, totalSupply] = await Promise.all([
          client.readContract({
            address: contractAddress as `0x${string}`,
            abi: COMPLIANT_ERC20_ABI,
            functionName: "name",
          }),
          client.readContract({
            address: contractAddress as `0x${string}`,
            abi: COMPLIANT_ERC20_ABI,
            functionName: "symbol",
          }),
          client.readContract({
            address: contractAddress as `0x${string}`,
            abi: COMPLIANT_ERC20_ABI,
            functionName: "DECIMALS",
          }),
          client.readContract({
            address: contractAddress as `0x${string}`,
            abi: COMPLIANT_ERC20_ABI,
            functionName: "totalSupply",
          }),
        ]);

        return {
          name: name as string,
          symbol: symbol as string,
          decimals: decimals as number,
          totalSupply: (totalSupply as bigint).toString(),
          contractAddress,
          demo: false,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to read token info: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * Mint tokens to the user's attested wallet.
   * Requires: user is authenticated, verified, and attested on the network.
   */
  mint: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().regex(/^\d+$/), // Wei amount as string
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Demo mode: simulate minting
      if (isDemoMode()) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 + Math.random() * 1000),
        );
        const mockTxHash =
          `0xdemo${Date.now().toString(16)}${"0".repeat(40)}`.slice(0, 66);
        return {
          success: true,
          txHash: mockTxHash,
          demo: true,
        };
      }

      // Check verification status
      const verificationStatus = getVerificationStatus(ctx.userId);
      if (!verificationStatus.verified) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Complete identity verification before minting tokens",
        });
      }

      // Check attestation on this network
      const attestation = getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId,
      );
      if (!attestation || attestation.status !== "confirmed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Register your identity on-chain before minting tokens",
        });
      }

      // Verify wallet matches attestation
      if (
        attestation.walletAddress.toLowerCase() !==
        input.walletAddress.toLowerCase()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Wallet address does not match your attested wallet",
        });
      }

      // Rate limit check
      if (!checkMintRateLimit(ctx.userId, input.networkId)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Mint rate limit exceeded. Try again in an hour.",
        });
      }

      // Validate amount
      const amount = BigInt(input.amount);
      if (amount <= BigInt(0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Amount must be positive",
        });
      }
      if (amount > MAX_MINT_AMOUNT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Amount exceeds maximum mint limit (10 tokens)",
        });
      }

      // Check network availability
      const network = getNetworkById(input.networkId);
      if (!network || !network.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const contractAddress = network.contracts.compliantERC20;
      if (!contractAddress) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `CompliantERC20 not deployed on ${input.networkId}`,
        });
      }

      if (!canCreateProvider(input.networkId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not configured`,
        });
      }

      // Mint tokens using provider's wallet (owner)
      try {
        const provider = createProvider(input.networkId);
        // Access the wallet client through the provider
        // @ts-expect-error - accessing protected method for mint operation
        const client = provider.getWalletClient();

        const txHash = await client.writeContract({
          address: contractAddress as `0x${string}`,
          abi: COMPLIANT_ERC20_ABI,
          functionName: "mint",
          args: [input.walletAddress as `0x${string}`, amount],
        });

        return {
          success: true,
          txHash,
          demo: false,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Mint failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * Check if an address is attested on a network.
   * Used to validate transfer recipients.
   */
  isAttested: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      }),
    )
    .query(async ({ input }) => {
      // Demo mode
      if (isDemoMode()) {
        return { isAttested: true, demo: true };
      }

      if (!canCreateProvider(input.networkId)) {
        return { isAttested: false, demo: false };
      }

      try {
        const provider = createProvider(input.networkId);
        const status = await provider.getAttestationStatus(input.address);
        return { isAttested: status.isAttested, demo: false };
      } catch {
        return { isAttested: false, demo: false };
      }
    }),

  /**
   * Get transfer history for a user's wallet.
   * Returns recent Transfer events involving the address.
   */
  history: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      // Demo mode
      if (isDemoMode()) {
        return {
          transfers: [
            {
              txHash: "0xdemo1...",
              from: "0x0000...0000",
              to: input.walletAddress,
              blockNumber: 12345,
              type: "mint" as const,
            },
          ],
          demo: true,
        };
      }

      const network = getNetworkById(input.networkId);
      if (!network || !network.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const contractAddress = network.contracts.compliantERC20;
      if (!contractAddress) {
        return { transfers: [], demo: false };
      }

      const chain = VIEM_CHAINS[network.chainId as keyof typeof VIEM_CHAINS];
      if (!chain) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unsupported chain ID: ${network.chainId}`,
        });
      }

      const client = createPublicClient({
        chain,
        transport: http(network.rpcUrl),
      });

      try {
        // Get Transfer events where user is sender or receiver
        // Note: CompliantERC20 uses non-standard Transfer event without value
        // because amounts are encrypted (FHE)
        const transferEvent = parseAbiItem(
          "event Transfer(address indexed from, address indexed to)",
        );
        const mintEvent = parseAbiItem(
          "event Mint(address indexed to, uint256 indexed amount)",
        );

        // Public RPCs limit block range to 50,000 blocks
        // Get current block and calculate safe range
        const currentBlock = await client.getBlockNumber();
        const MAX_BLOCK_RANGE = BigInt(50000);
        const fromBlock =
          currentBlock > MAX_BLOCK_RANGE
            ? currentBlock - MAX_BLOCK_RANGE
            : BigInt(0);

        const [transfersFrom, transfersTo, mints] = await Promise.all([
          client.getLogs({
            address: contractAddress as `0x${string}`,
            event: transferEvent,
            args: { from: input.walletAddress as `0x${string}` },
            fromBlock,
            toBlock: "latest",
          }),
          client.getLogs({
            address: contractAddress as `0x${string}`,
            event: transferEvent,
            args: { to: input.walletAddress as `0x${string}` },
            fromBlock,
            toBlock: "latest",
          }),
          client.getLogs({
            address: contractAddress as `0x${string}`,
            event: mintEvent,
            args: { to: input.walletAddress as `0x${string}` },
            fromBlock,
            toBlock: "latest",
          }),
        ]);

        // Combine and sort by block number
        const allEvents = [
          ...transfersFrom.map((log) => ({
            txHash: log.transactionHash,
            from: log.args.from as string,
            to: log.args.to as string,
            blockNumber: Number(log.blockNumber),
            type: "transfer_out" as const,
          })),
          ...transfersTo.map((log) => ({
            txHash: log.transactionHash,
            from: log.args.from as string,
            to: log.args.to as string,
            blockNumber: Number(log.blockNumber),
            type: "transfer_in" as const,
          })),
          ...mints.map((log) => ({
            txHash: log.transactionHash,
            from: "0x0000000000000000000000000000000000000000",
            to: log.args.to as string,
            blockNumber: Number(log.blockNumber),
            type: "mint" as const,
            amount: log.args.amount?.toString(),
          })),
        ];

        // Sort by block number descending and limit
        const sorted = allEvents
          .sort((a, b) => b.blockNumber - a.blockNumber)
          .slice(0, input.limit);

        return { transfers: sorted, demo: false };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch history: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * Check if ComplianceRules has access to the user's encrypted identity data.
   * Uses IdentityRegistry AccessGranted event logs.
   */
  complianceAccess: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      }),
    )
    .query(async ({ input }) => {
      // Demo mode
      if (isDemoMode()) {
        return { granted: true, demo: true };
      }

      const network = getNetworkById(input.networkId);
      if (!network || !network.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const identityRegistry = network.contracts.identityRegistry;
      const complianceRules = network.contracts.complianceRules;
      if (!identityRegistry || !complianceRules) {
        return { granted: false, demo: false };
      }

      const chain = VIEM_CHAINS[network.chainId as keyof typeof VIEM_CHAINS];
      if (!chain) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unsupported chain ID: ${network.chainId}`,
        });
      }

      const client = createPublicClient({
        chain,
        transport: http(network.rpcUrl),
      });

      try {
        const accessGrantedEvent = parseAbiItem(
          "event AccessGranted(address indexed user, address indexed grantee)",
        );

        // Public RPCs limit block range to 50,000 blocks
        const currentBlock = await client.getBlockNumber();
        const MAX_BLOCK_RANGE = BigInt(50000);
        const fromBlock =
          currentBlock > MAX_BLOCK_RANGE
            ? currentBlock - MAX_BLOCK_RANGE
            : BigInt(0);

        const logs = await client.getLogs({
          address: identityRegistry as `0x${string}`,
          event: accessGrantedEvent,
          args: {
            user: input.walletAddress as `0x${string}`,
            grantee: complianceRules as `0x${string}`,
          },
          fromBlock,
          toBlock: "latest",
        });

        return { granted: logs.length > 0, demo: false };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to check compliance access: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * Get available networks with CompliantERC20 deployed.
   */
  networks: protectedProcedure.query(() => {
    const networks = getEnabledNetworks();
    return networks
      .filter((n) => n.contracts.compliantERC20)
      .map((n) => ({
        id: n.id,
        name: n.name,
        chainId: n.chainId,
        contractAddress: n.contracts.compliantERC20,
        complianceRules: n.contracts.complianceRules ?? null,
        identityRegistry: n.contracts.identityRegistry ?? null,
      }));
  }),
});
