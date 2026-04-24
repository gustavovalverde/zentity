import {
  beginCibaApproval as beginSdkCibaApproval,
  type CibaPendingAuthorization,
  type CibaPollResult,
  type CibaTokenSet,
  createPendingApproval as createSdkPendingApproval,
  logPendingApprovalHandoff as logSdkPendingApprovalHandoff,
  pollCibaToken as pollSdkCibaToken,
  pollCibaTokenOnce as pollSdkCibaTokenOnce,
  requestCibaApproval as requestSdkCibaApproval,
  CibaDeniedError as SdkCibaDeniedError,
  type CibaRequest as SdkCibaRequest,
  CibaTimeoutError as SdkCibaTimeoutError,
} from "@zentity/sdk";
import { createDpopProof, type DpopKeyPair } from "../runtime/dpop-proof.js";

export type {
  CibaPendingApproval,
  CibaPendingAuthorization,
  CibaPollResult,
  CibaTokenSet,
} from "@zentity/sdk";
export const CibaDeniedError = SdkCibaDeniedError;
export const CibaTimeoutError = SdkCibaTimeoutError;
export const createPendingApproval = createSdkPendingApproval;
export const logPendingApprovalHandoff = logSdkPendingApprovalHandoff;

export interface CibaRequest extends Omit<SdkCibaRequest, "dpopSigner"> {
  dpopKey: DpopKeyPair;
}

interface PollCibaTokenParams {
  clientId: string;
  dpopKey: DpopKeyPair;
  tokenEndpoint: string;
}

function createDpopSigner(dpopKey: DpopKeyPair): SdkCibaRequest["dpopSigner"] {
  return {
    proofFor(method, url, accessToken, nonce) {
      return createDpopProof(
        dpopKey,
        method,
        url instanceof URL ? url.toString() : url,
        accessToken,
        nonce
      );
    },
  };
}

function mapCibaRequest(params: CibaRequest): SdkCibaRequest {
  const { dpopKey, ...sdkParams } = params;
  return {
    ...sdkParams,
    dpopSigner: createDpopSigner(dpopKey),
  };
}

function mapPollParams(
  params: PollCibaTokenParams
): Pick<SdkCibaRequest, "clientId" | "dpopSigner" | "tokenEndpoint"> {
  return {
    clientId: params.clientId,
    dpopSigner: createDpopSigner(params.dpopKey),
    tokenEndpoint: params.tokenEndpoint,
  };
}

export function requestCibaApproval(
  params: CibaRequest
): Promise<CibaTokenSet> {
  return requestSdkCibaApproval(mapCibaRequest(params));
}

export function beginCibaApproval(
  params: CibaRequest
): Promise<CibaPendingAuthorization> {
  return beginSdkCibaApproval(mapCibaRequest(params));
}

export function pollCibaToken(
  params: PollCibaTokenParams,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaTokenSet> {
  return pollSdkCibaToken(mapPollParams(params), pendingAuthorization);
}

export function pollCibaTokenOnce(
  params: PollCibaTokenParams,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaPollResult> {
  return pollSdkCibaTokenOnce(mapPollParams(params), pendingAuthorization);
}
