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
import {
  ATTR,
  compliantErc20Abi,
  identityRegistryAbi,
} from "@zentity/contracts";
import { maxUint64, parseAbiItem, parseUnits } from "viem";
import { z } from "zod";

import {
  canCreateProvider,
  createProvider,
} from "@/lib/blockchain/attestation/providers";
import {
  createNetworkPublicClient,
  getEnabledNetworks,
  getExplorerTxUrl,
  getNetworkById,
} from "@/lib/blockchain/networks";
import { getBlockchainAttestationByUserAndNetwork } from "@/lib/db/queries/attestation";
import { createRateLimiter } from "@/lib/http/rate-limit";

import { protectedProcedure, requireFeature, router } from "../server";

// CompliantERC20 ABI (kept in sync with contracts package)
const COMPLIANT_ERC20_ABI = compliantErc20Abi;

// Rate limiting for mint requests: 3 per hour per user and network.
const mintLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 3 });
// Note: Contract uses euint64 for balances with 18 decimals.
// uint64.max = ~18.4 * 10^18, so max total supply is ~18 tokens.
// We limit per-mint to 10 tokens to allow multiple mints before hitting cap.
const MAX_MINT_AMOUNT = parseUnits("10", 18); // 10 tokens
const UINT64_MAX = maxUint64; // Max supply for euint64 balances

/** Whole tokens (two decimals) left under the euint64 cap. */
function toRemainingTokens(remaining: bigint): number {
  return Number(remaining / BigInt(10 ** 16)) / 100;
}

// biome-ignore lint/suspicious/noBitwiseOperators: contract access is represented as a bitmask
const REQUIRED_COMPLIANCE_ATTRIBUTES = ATTR.COMPLIANCE | ATTR.BLACKLIST;

export const compliantTokenRouter = router({
  /**
   * Get token contract info for a network.
   */
  info: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .query(async ({ input }) => {
      const network = getNetworkById(input.networkId);
      if (!network?.enabled) {
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

      const client = createNetworkPublicClient(network);

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

        const remaining = UINT64_MAX - totalSupply;
        const remainingTokens = toRemainingTokens(remaining);

        return {
          name,
          symbol,
          decimals,
          totalSupply: totalSupply.toString(),
          remainingSupply: remaining.toString(),
          remainingTokens,
          contractAddress,
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
   * Requires: Tier 3 + AAL2 (passkey auth), verified, and attested on the network.
   */
  mint: protectedProcedure
    .use(requireFeature("token_minting"))
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().regex(/^\d+$/), // Wei amount as string
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Tier guard ensures user is verified (Tier 3 + AAL2)

      // Check attestation on this network
      const attestation = await getBlockchainAttestationByUserAndNetwork(
        ctx.userId,
        input.networkId
      );
      if (attestation?.status !== "confirmed") {
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
      if (mintLimiter.check(`${ctx.userId}:${input.networkId}`).limited) {
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
      if (!network?.enabled) {
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

      // Pre-check: verify supply capacity before sending tx
      const publicClient = createNetworkPublicClient(network);
      const currentSupply = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: COMPLIANT_ERC20_ABI,
        functionName: "totalSupply",
      });

      if (currentSupply + amount > UINT64_MAX) {
        const remainingTokens = toRemainingTokens(UINT64_MAX - currentSupply);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Supply cap reached. Only ${remainingTokens.toFixed(2)} tokens can be minted (euint64 limit).`,
        });
      }

      // Mint tokens using provider's wallet (owner)
      try {
        const provider = createProvider(input.networkId);
        const walletClient = provider.getWalletClient();

        const txHash = await walletClient.writeContract({
          address: contractAddress as `0x${string}`,
          abi: COMPLIANT_ERC20_ABI,
          functionName: "mint",
          args: [input.walletAddress as `0x${string}`, amount],
        });

        // Wait for transaction confirmation before returning success
        // This ensures logs are queryable and history shows the mint
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
        });

        return {
          success: true,
          txHash,
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
      })
    )
    .query(async ({ input }) => {
      if (!canCreateProvider(input.networkId)) {
        return { isAttested: false, status: "unknown" as const };
      }

      try {
        const provider = createProvider(input.networkId);
        const status = await provider.getAttestationStatus(input.address);
        return {
          isAttested: status.isAttested,
          status: status.isAttested
            ? ("attested" as const)
            : ("not_attested" as const),
        };
      } catch {
        return { isAttested: false, status: "unknown" as const };
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
      })
    )
    .query(async ({ input }) => {
      const network = getNetworkById(input.networkId);
      if (!network?.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const contractAddress = network.contracts.compliantERC20;
      if (!contractAddress) {
        return { transfers: [] };
      }

      const client = createNetworkPublicClient(network);

      try {
        // Get Transfer events where user is sender or receiver
        // Note: CompliantERC20 uses non-standard Transfer event without value
        // because amounts are encrypted (FHE)
        const transferEvent = parseAbiItem(
          "event Transfer(address indexed from, address indexed to)"
        );
        const mintEvent = parseAbiItem(
          "event Mint(address indexed to, uint256 indexed amount)"
        );

        // Public RPCs limit block range to 50,000 blocks
        // Get current block and calculate safe range
        const currentBlock = await client.getBlockNumber();
        const MAX_BLOCK_RANGE = BigInt(50_000);
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
          .toSorted((a, b) => b.blockNumber - a.blockNumber)
          .slice(0, input.limit);

        return { transfers: sorted };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch history: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * Check if ComplianceRules has access to the user's encrypted identity data.
   * Uses IdentityRegistry AttributeAccessGranted event logs.
   */
  complianceAccess: protectedProcedure
    .input(
      z.object({
        networkId: z.string(),
        walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      })
    )
    .query(async ({ input }) => {
      const network = getNetworkById(input.networkId);
      if (!network?.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Network ${input.networkId} is not available`,
        });
      }

      const identityRegistry = network.contracts.identityRegistry;
      const complianceRules = network.contracts.complianceRules;
      if (!(identityRegistry && complianceRules)) {
        return {
          granted: false,
          txHash: null,
          blockNumber: null,
          explorerUrl: null,
        };
      }

      const client = createNetworkPublicClient(network);

      try {
        const grantedAttributes = await client.readContract({
          address: identityRegistry as `0x${string}`,
          abi: identityRegistryAbi,
          functionName: "getGrantedAttributes",
          args: [
            input.walletAddress as `0x${string}`,
            complianceRules as `0x${string}`,
          ],
        });
        const hasRequiredAttributes =
          // biome-ignore lint/suspicious/noBitwiseOperators: contract access is represented as a bitmask
          (grantedAttributes & REQUIRED_COMPLIANCE_ATTRIBUTES) ===
          REQUIRED_COMPLIANCE_ATTRIBUTES;

        if (!hasRequiredAttributes) {
          return {
            granted: false,
            txHash: null,
            blockNumber: null,
            explorerUrl: null,
          };
        }

        const accessGrantedEvent = parseAbiItem(
          "event AttributeAccessGranted(address indexed user, address indexed grantee, uint8 attributeMask, uint8 purpose)"
        );

        // Public RPCs limit block range to 50,000 blocks
        const currentBlock = await client.getBlockNumber();
        const MAX_BLOCK_RANGE = BigInt(50_000);
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

        const firstLog = logs[0];
        const latestLog =
          firstLog === undefined
            ? null
            : logs.reduce(
                (latest, log) =>
                  (log.blockNumber ?? BigInt(0)) >
                  (latest.blockNumber ?? BigInt(0))
                    ? log
                    : latest,
                firstLog
              );

        const txHash = latestLog?.transactionHash ?? null;
        const blockNumber = latestLog?.blockNumber
          ? Number(latestLog.blockNumber)
          : null;

        return {
          granted: true,
          txHash,
          blockNumber,
          explorerUrl: txHash
            ? getExplorerTxUrl(input.networkId, txHash)
            : null,
        };
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
        explorerUrl: n.explorer ?? null,
      }));
  }),
});
