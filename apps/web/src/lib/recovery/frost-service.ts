import "server-only";

import crypto from "node:crypto";

import { env } from "@/env";
import { getSignerPin, pinSignerIdentity } from "@/lib/db/queries/recovery";

type Ciphersuite = "secp256k1" | "ed25519";

interface SignerInfo {
  hpke_pubkey: string;
  hpke_pubkey_signature: string | null;
  hpke_pubkey_verified: boolean;
  participant_id: number;
  signer_id: string;
  signer_identity_pubkey: string | null;
}

interface DkgInitResponse {
  session_id: string;
}

interface DkgFinalizeResponse {
  group_pubkey?: string | null;
  public_key_package?: string | null;
}

interface SigningInitResponse {
  session_id: string;
}

interface SigningAggregateResponse {
  signature?: string | null;
}

const DEFAULT_CIPHERSUITE: Ciphersuite = "secp256k1";

function getAuthHeaders(): Record<string, string> {
  const token = env.INTERNAL_SERVICE_TOKEN;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Request failed: ${response.status} ${response.statusText} ${bodyText}`
    );
  }

  return (await response.json()) as T;
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function toParticipantMap<T>(entries: [number, T][]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [id, value] of entries) {
    result[String(id)] = value;
  }
  return result;
}

function resolveSignerEndpoints(total: number): string[] {
  const endpoints = env.SIGNER_ENDPOINTS;
  if (endpoints.length < total) {
    throw new Error(
      `Not enough signer endpoints configured. Need ${total}, have ${endpoints.length}.`
    );
  }
  return endpoints.slice(0, total);
}

function resolveSignerEndpointMap(total: number): Map<number, string> {
  const endpoints = resolveSignerEndpoints(total);
  const map = new Map<number, string>();
  endpoints.forEach((endpoint, index) => {
    map.set(index + 1, endpoint);
  });
  return map;
}

async function fetchSignerInfo(endpoint: string): Promise<SignerInfo> {
  return await fetchJson<SignerInfo>(`${endpoint}/signer/info`);
}

// DER-encoded SPKI prefix for Ed25519 public keys (12 bytes)
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify an Ed25519 signature over the HPKE public key.
 * Returns true if the signature is valid for the given identity pubkey.
 */
function verifyHpkeSignature(info: SignerInfo): boolean {
  if (!(info.hpke_pubkey_signature && info.signer_identity_pubkey)) {
    return false;
  }

  const message = Buffer.from(
    `frost-signer-hpke|${info.signer_id}|${info.hpke_pubkey}`
  );
  const rawPubkey = Buffer.from(info.signer_identity_pubkey, "base64");
  const derPubkey = Buffer.concat([ED25519_SPKI_PREFIX, rawPubkey]);
  const keyObject = crypto.createPublicKey({
    key: derPubkey,
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(info.hpke_pubkey_signature, "base64");

  return crypto.verify(null, message, keyObject, signature);
}

/**
 * Verify and pin HPKE key for a signer endpoint.
 * - Pin exists → verify signature against pinned pubkey, throw on mismatch
 * - No pin → verify signature, pin the identity pubkey on success
 * - Missing signature when pin exists → throw
 */
async function verifyAndPinSignerKey(
  endpoint: string,
  info: SignerInfo
): Promise<void> {
  const existingPin = await getSignerPin(endpoint);

  if (existingPin) {
    if (!(info.hpke_pubkey_signature && info.signer_identity_pubkey)) {
      throw new Error(
        `Signer ${info.signer_id} at ${endpoint} returned no HPKE signature but has a pinned identity key`
      );
    }
    if (existingPin.identityPubkey !== info.signer_identity_pubkey) {
      throw new Error(
        `Signer ${info.signer_id} at ${endpoint} identity key mismatch: expected ${existingPin.identityPubkey}, got ${info.signer_identity_pubkey}`
      );
    }
    if (!verifyHpkeSignature(info)) {
      throw new Error(
        `Signer ${info.signer_id} at ${endpoint} HPKE pubkey signature verification failed`
      );
    }
    return;
  }

  // First encounter — verify and pin
  if (!(info.signer_identity_pubkey && verifyHpkeSignature(info))) {
    throw new Error(
      `Signer ${info.signer_id} at ${endpoint} HPKE pubkey signature verification failed on first contact`
    );
  }

  await pinSignerIdentity({
    id: crypto.randomUUID(),
    signerEndpoint: endpoint,
    identityPubkey: info.signer_identity_pubkey,
  });
}

export async function createRecoveryKeySet(params: {
  threshold?: number | undefined;
  totalGuardians?: number | undefined;
  ciphersuite?: Ciphersuite | undefined;
}): Promise<{
  groupPubkey: string;
  publicKeyPackage: string;
  ciphersuite: Ciphersuite;
  threshold: number;
  totalGuardians: number;
}> {
  const threshold = params.threshold ?? 2;
  const totalGuardians = params.totalGuardians ?? 3;
  const ciphersuite = params.ciphersuite ?? DEFAULT_CIPHERSUITE;

  const coordinatorUrl = env.SIGNER_COORDINATOR_URL;
  const signerEndpoints = resolveSignerEndpoints(totalGuardians);

  const signerInfos = await Promise.all(
    signerEndpoints.map((endpoint) => fetchSignerInfo(endpoint))
  );

  // Verify HPKE key signatures and pin identity keys (TOFU on first DKG)
  await Promise.all(
    signerInfos.map((info, index) => {
      const endpoint = signerEndpoints[index];
      if (!endpoint) {
        throw new Error(`Missing endpoint for signer index ${index}`);
      }
      return verifyAndPinSignerKey(endpoint, info);
    })
  );

  const participantHpke = toParticipantMap(
    signerInfos.map((info, index) => [
      info.participant_id || index + 1,
      info.hpke_pubkey,
    ])
  );

  const initResponse = await fetchJson<DkgInitResponse>(
    `${coordinatorUrl}/dkg/init`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        threshold,
        total_participants: totalGuardians,
        ciphersuite,
        participant_hpke_pubkeys: participantHpke,
      }),
    }
  );

  const sessionId = initResponse.session_id;

  const round1Results = await Promise.all(
    signerInfos.map((info, index) =>
      fetchJson<{ package: string }>(
        `${signerEndpoints[index] ?? ""}/signer/dkg/round1`,
        {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionId,
            participant_id: info.participant_id || index + 1,
            ciphersuite,
            threshold,
            total_participants: totalGuardians,
          }),
        }
      )
    )
  );

  const round1Packages = toParticipantMap(
    round1Results.map((result, index) => [
      signerInfos[index]?.participant_id || index + 1,
      result.package,
    ])
  );

  for (const [index, result] of round1Results.entries()) {
    await fetchJson(`${coordinatorUrl}/dkg/round1`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        session_id: sessionId,
        participant_id: signerInfos[index]?.participant_id || index + 1,
        package: result.package,
      }),
    });
  }

  const round2Results = await Promise.all(
    signerInfos.map((info, index) =>
      fetchJson<{ packages: Record<string, string> }>(
        `${signerEndpoints[index]}/signer/dkg/round2`,
        {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionId,
            participant_id: info.participant_id || index + 1,
            ciphersuite,
            round1_packages: round1Packages,
            participant_hpke_pubkeys: participantHpke,
          }),
        }
      )
    )
  );

  for (const [fromIndex, round2] of round2Results.entries()) {
    const fromId = signerInfos[fromIndex]?.participant_id || fromIndex + 1;
    const packages = round2.packages ?? {};
    for (const [toId, encrypted] of Object.entries(packages)) {
      await fetchJson(`${coordinatorUrl}/dkg/round2`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          session_id: sessionId,
          from_participant_id: fromId,
          to_participant_id: Number(toId),
          encrypted_package: encrypted,
        }),
      });
    }
  }

  const finalize = await fetchJson<DkgFinalizeResponse>(
    `${coordinatorUrl}/dkg/finalize`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    }
  );

  if (!(finalize.group_pubkey && finalize.public_key_package)) {
    throw new Error("DKG finalize response missing group key data.");
  }

  return {
    groupPubkey: finalize.group_pubkey,
    publicKeyPackage: finalize.public_key_package,
    ciphersuite,
    threshold,
    totalGuardians,
  };
}

/**
 * Initialize a FROST signing session with the coordinator.
 * Returns the session ID needed for guardian JWT minting.
 */
export async function initSigningSession(params: {
  groupPubkey: string;
  message: string;
  participantIds: number[];
}): Promise<{ sessionId: string }> {
  const coordinatorUrl = env.SIGNER_COORDINATOR_URL;
  const initResponse = await fetchJson<SigningInitResponse>(
    `${coordinatorUrl}/signing/init`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        group_pubkey: params.groupPubkey,
        message: toBase64(params.message),
        selected_signers: params.participantIds,
      }),
    }
  );
  return { sessionId: initResponse.session_id };
}

/**
 * Execute FROST signing rounds (commit → partial → aggregate).
 * Requires a session ID from initSigningSession.
 */
export async function executeSigningRounds(params: {
  sessionId: string;
  groupPubkey: string;
  ciphersuite: Ciphersuite;
  message: string;
  participantIds: number[];
  totalParticipants?: number | undefined;
  guardianAssertions?: Map<number, string> | undefined;
  endpointOverrides?: Map<number, string> | undefined;
}): Promise<{ signature: string; signaturesCollected: number }> {
  const coordinatorUrl = env.SIGNER_COORDINATOR_URL;
  const totalParticipants =
    params.totalParticipants ?? params.participantIds.length;
  const endpointMap = resolveSignerEndpointMap(totalParticipants);

  if (params.endpointOverrides) {
    for (const [participantId, endpoint] of params.endpointOverrides) {
      endpointMap.set(participantId, endpoint);
    }
  }

  const signerEntries = params.participantIds.map((participantId) => {
    const endpoint = endpointMap.get(participantId);
    if (!endpoint) {
      throw new Error(
        `Missing signer endpoint for participant ${participantId}.`
      );
    }
    return { participantId, endpoint };
  });

  const { sessionId } = params;

  const commitments = await Promise.all(
    signerEntries.map(({ endpoint, participantId }) =>
      fetchJson<{ commitment: string }>(`${endpoint}/signer/sign/commit`, {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          group_pubkey: params.groupPubkey,
          ciphersuite: params.ciphersuite,
          ...(params.guardianAssertions?.has(participantId) && {
            guardian_assertion: params.guardianAssertions.get(participantId),
          }),
        }),
      }).then((result) => ({
        participantId,
        commitment: result.commitment,
      }))
    )
  );

  for (const commitment of commitments) {
    await fetchJson(`${coordinatorUrl}/signing/commit`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        session_id: sessionId,
        participant_id: commitment.participantId,
        commitment: commitment.commitment,
      }),
    });
  }

  const allCommitments = toParticipantMap(
    commitments.map((entry) => [entry.participantId, entry.commitment])
  );

  const partials = await Promise.all(
    signerEntries.map(({ endpoint, participantId }) =>
      fetchJson<{ partial_signature: string }>(
        `${endpoint}/signer/sign/partial`,
        {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionId,
            group_pubkey: params.groupPubkey,
            ciphersuite: params.ciphersuite,
            message: toBase64(params.message),
            all_commitments: allCommitments,
            ...(params.guardianAssertions?.has(participantId) && {
              guardian_assertion: params.guardianAssertions.get(participantId),
            }),
          }),
        }
      ).then((result) => ({
        participantId,
        partialSignature: result.partial_signature,
      }))
    )
  );

  for (const partial of partials) {
    await fetchJson(`${coordinatorUrl}/signing/partial`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        session_id: sessionId,
        participant_id: partial.participantId,
        message: toBase64(params.message),
        all_commitments: allCommitments,
        partial_signature: partial.partialSignature,
      }),
    });
  }

  const aggregate = await fetchJson<SigningAggregateResponse>(
    `${coordinatorUrl}/signing/aggregate`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    }
  );

  if (!aggregate.signature) {
    throw new Error("Signing aggregation failed to return signature.");
  }

  return {
    signature: aggregate.signature,
    signaturesCollected: partials.length,
  };
}
