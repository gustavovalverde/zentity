import type { EffectiveSessionLifecycle } from "@/lib/ciba/agent-lifecycle";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  AgentManagementError,
  getHostDetailForUser,
  getSessionDetailForUser,
  listHostsForUser,
  type ManagedHostDetail,
  type ManagedHostPolicy,
  type ManagedHostSummary,
  type ManagedSessionDetail,
  type ManagedSessionGrant,
  type ManagedSessionSummary,
  revokeSessionForActor,
  updateGrantForUser,
} from "@/lib/agents/management";

import { protectedProcedure, router } from "../server";

function asTrpcError(error: unknown): TRPCError {
  if (!(error instanceof AgentManagementError)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Agent management failed",
      cause: error,
    });
  }

  switch (error.code) {
    case "not_found":
      return new TRPCError({ code: "NOT_FOUND", message: error.message });
    case "forbidden":
      return new TRPCError({ code: "FORBIDDEN", message: error.message });
    case "conflict":
      return new TRPCError({ code: "CONFLICT", message: error.message });
    default:
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
  }
}

function serializeLifecycle(lifecycle: EffectiveSessionLifecycle) {
  return {
    createdAt: lifecycle.createdAt.toISOString(),
    idleExpiresAt: lifecycle.idleExpiresAt.toISOString(),
    idleTtlSec: lifecycle.idleTtlSec,
    lastActiveAt: lifecycle.lastActiveAt.toISOString(),
    maxExpiresAt: lifecycle.maxExpiresAt.toISOString(),
    maxLifetimeSec: lifecycle.maxLifetimeSec,
    status: lifecycle.status,
  };
}

function serializeGrant(grant: ManagedSessionGrant) {
  return {
    capabilityName: grant.capabilityName,
    constraints: grant.constraints,
    grantedAt: grant.grantedAt?.toISOString() ?? null,
    hostPolicyId: grant.hostPolicyId,
    id: grant.id,
    source: grant.source,
    status: grant.status,
  };
}

function serializeSession(session: ManagedSessionSummary) {
  const lifecycle = serializeLifecycle(session.lifecycle);
  return {
    createdAt: lifecycle.createdAt,
    displayName: session.displayName,
    grants: session.grants.map(serializeGrant),
    hostId: session.hostId,
    id: session.id,
    idleExpiresAt: lifecycle.idleExpiresAt,
    idleTtlSec: lifecycle.idleTtlSec,
    lastActiveAt: lifecycle.lastActiveAt,
    lifecycle,
    maxExpiresAt: lifecycle.maxExpiresAt,
    maxLifetimeSec: lifecycle.maxLifetimeSec,
    model: session.model,
    runtime: session.runtime,
    status: lifecycle.status,
    usageToday: session.usageToday,
    version: session.version,
  };
}

function serializeHost(host: ManagedHostSummary) {
  return {
    attestationProvider: host.attestationProvider,
    attestationTier: host.attestationTier,
    createdAt: host.createdAt.toISOString(),
    id: host.id,
    name: host.name,
    publicKeyThumbprint: host.publicKeyThumbprint,
    sessionCount: host.sessionCount,
    sessions: host.sessions.map(serializeSession),
    status: host.status,
    updatedAt: host.updatedAt.toISOString(),
  };
}

function serializeHostPolicy(policy: ManagedHostPolicy) {
  return {
    capabilityName: policy.capabilityName,
    constraints: policy.constraints,
    cooldownSec: policy.cooldownSec,
    createdAt: policy.createdAt.toISOString(),
    dailyLimitAmount: policy.dailyLimitAmount,
    dailyLimitCount: policy.dailyLimitCount,
    grantedBy: policy.grantedBy,
    id: policy.id,
    revokedAt: policy.revokedAt?.toISOString() ?? null,
    source: policy.source,
    status: policy.status,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function serializeHostDetail(host: ManagedHostDetail) {
  return {
    ...serializeHost(host),
    policies: host.policies.map(serializeHostPolicy),
  };
}

function serializeSessionDetail(session: ManagedSessionDetail) {
  const lifecycle = serializeLifecycle(session.lifecycle);
  return {
    attestationProvider: session.attestationProvider,
    attestationTier: session.attestationTier,
    createdAt: lifecycle.createdAt,
    grants: session.grants.map((grant) => ({
      ...serializeGrant(grant),
      usageToday: grant.usageToday,
    })),
    hostId: session.hostId,
    hostName: session.hostName,
    hostStatus: session.hostStatus,
    id: session.id,
    idleExpiresAt: lifecycle.idleExpiresAt,
    idleTtlSec: lifecycle.idleTtlSec,
    lastActiveAt: lifecycle.lastActiveAt,
    lifecycle,
    maxExpiresAt: lifecycle.maxExpiresAt,
    maxLifetimeSec: lifecycle.maxLifetimeSec,
    status: lifecycle.status,
  };
}

export const agentRouter = router({
  listHosts: protectedProcedure.query(async ({ ctx }) => {
    return serializeHosts(await listHostsForUser(ctx.session.user.id));
  }),

  getHostDetail: protectedProcedure
    .input(z.object({ hostId: z.string() }))
    .query(async ({ ctx, input }) => {
      const host = await getHostDetailForUser(
        ctx.session.user.id,
        input.hostId
      );
      return host ? serializeHostDetail(host) : null;
    }),

  getAgentDetail: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const detail = await getSessionDetailForUser(
        ctx.session.user.id,
        input.sessionId
      );
      return detail ? serializeSessionDetail(detail) : null;
    }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await revokeSessionForActor(
          { kind: "browser_user", userId: ctx.session.user.id },
          input.sessionId
        );
      } catch (error) {
        throw asTrpcError(error);
      }
    }),

  updateGrant: protectedProcedure
    .input(
      z.object({
        grantId: z.string(),
        constraints: z.string().nullable().optional(),
        status: z.enum(["active", "denied", "revoked"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateGrantForUser(ctx.session.user.id, input);
      } catch (error) {
        throw asTrpcError(error);
      }
    }),
});

function serializeHosts(hosts: ManagedHostSummary[]) {
  return hosts.map(serializeHost);
}
