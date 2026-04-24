import "server-only";

import { identityRegistryMirrorAbi } from "@zentity/contracts";
import {
  type Address,
  createWalletClient,
  type Hex,
  http,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { toHexPrefixed } from "@/lib/blockchain/attestation/providers";
import { getBaseSepoliaMirrorConfig } from "@/lib/blockchain/networks";
import {
  getBlockchainAttestationById,
  getCurrentMirrorComplianceLevel,
} from "@/lib/db/queries/attestation";

interface MirrorWriteResult {
  reason?: string;
  status: "skipped" | "submitted";
  txHash?: Hex;
}

function createMirrorSession() {
  const config = getBaseSepoliaMirrorConfig();
  if (!config) {
    throw new Error("Base Sepolia identity registry mirror is not configured");
  }

  if (!config.registrarPrivateKey) {
    throw new Error("BASE_SEPOLIA_REGISTRAR_PRIVATE_KEY is not configured");
  }

  const account = privateKeyToAccount(
    toHexPrefixed(config.registrarPrivateKey)
  );

  return {
    mirrorAddress: config.contracts.identityRegistryMirror as Address,
    client: createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    }).extend(publicActions),
  };
}

type MirrorSession = ReturnType<typeof createMirrorSession>;

let mirrorSession: MirrorSession | undefined;

function getMirrorSession() {
  mirrorSession ??= createMirrorSession();
  return mirrorSession;
}

async function readMirrorLevel(
  userAddress: Address,
  session: MirrorSession
): Promise<{ currentLevel: number; isAttested: boolean }> {
  const [isAttested, currentLevel] = await Promise.all([
    session.client.readContract({
      address: session.mirrorAddress,
      abi: identityRegistryMirrorAbi,
      functionName: "isAttested",
      args: [userAddress],
    }),
    session.client.readContract({
      address: session.mirrorAddress,
      abi: identityRegistryMirrorAbi,
      functionName: "currentLevel",
      args: [userAddress],
    }),
  ]);

  return {
    isAttested: Boolean(isAttested),
    currentLevel: Number(currentLevel),
  };
}

async function readMirrorAttestation(
  userAddress: Address,
  session: MirrorSession
): Promise<boolean> {
  const isAttested = await session.client.readContract({
    address: session.mirrorAddress,
    abi: identityRegistryMirrorAbi,
    functionName: "isAttested",
    args: [userAddress],
  });

  return Boolean(isAttested);
}

export async function writeMirrorCompliance(
  blockchainAttestationId: string
): Promise<MirrorWriteResult> {
  const attestation = await getBlockchainAttestationById(
    blockchainAttestationId
  );
  if (!attestation) {
    return { status: "skipped", reason: "attestation_not_found" };
  }

  if (attestation.status !== "confirmed") {
    return { status: "skipped", reason: `attestation_${attestation.status}` };
  }

  const userAddress = attestation.walletAddress as Address;
  const session = getMirrorSession();
  const [level, mirrorLevel] = await Promise.all([
    getCurrentMirrorComplianceLevel(attestation.userId),
    readMirrorLevel(userAddress, session),
  ]);

  if (mirrorLevel.isAttested && mirrorLevel.currentLevel === level) {
    return { status: "skipped", reason: "mirror_already_current" };
  }

  const txHash = await session.client.writeContract({
    address: session.mirrorAddress,
    abi: identityRegistryMirrorAbi,
    functionName: "recordCompliance",
    args: [userAddress, level],
  });

  await session.client.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });

  return { status: "submitted", txHash };
}

export async function writeMirrorRevocation(
  blockchainAttestationId: string
): Promise<MirrorWriteResult> {
  const attestation = await getBlockchainAttestationById(
    blockchainAttestationId
  );
  if (!attestation) {
    return { status: "skipped", reason: "attestation_not_found" };
  }

  const userAddress = attestation.walletAddress as Address;
  const session = getMirrorSession();
  const isAttested = await readMirrorAttestation(userAddress, session);
  if (!isAttested) {
    return { status: "skipped", reason: "mirror_not_attested" };
  }

  const txHash = await session.client.writeContract({
    address: session.mirrorAddress,
    abi: identityRegistryMirrorAbi,
    functionName: "revokeAttestation",
    args: [userAddress],
  });

  await session.client.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });

  return { status: "submitted", txHash };
}
