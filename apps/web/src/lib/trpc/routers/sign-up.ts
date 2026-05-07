import "server-only";

import z from "zod";

import { auth } from "@/lib/auth/auth-config";
import { getAppOrigin } from "@/lib/auth/origin";
import {
  clearAnonymousFlag,
  deleteStaleAnonymousUserByEmail,
  emailBelongsToAnotherAccount,
  linkWalletAddress,
  updateUserEmail,
  updateUserWalletIdentity,
} from "@/lib/db/queries/auth";
import { upsertIdentityBundle } from "@/lib/db/queries/identity";
import { sendAccountExistsAlert } from "@/lib/email/auth";
import { accountAlertLimiter } from "@/lib/http/rate-limit";
import { logError } from "@/lib/logging/error-logger";
import { hashIdentifier } from "@/lib/observability/telemetry";

import { protectedProcedure, router } from "../server";

const BUNDLE_ISSUER_ID = "zentity";
const BUNDLE_POLICY_VERSION = "1.0";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Drizzle wraps libsql errors as `Error("Failed query: ...")` and preserves
  // the original LibsqlError (with `code` and message) on `.cause`. Walk the
  // chain so the wrapper doesn't mask the constraint code.
  if ("code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return true;
  }
  if (error.message.includes("UNIQUE constraint failed")) {
    return true;
  }
  if ("cause" in error && error.cause) {
    return isUniqueConstraintError(error.cause);
  }
  return false;
}

export const signUpRouter = router({
  completeAccountCreation: protectedProcedure
    .input(
      z
        .object({
          email: z.email().optional(),
          wallet: z
            .object({
              address: z.string().min(1),
              chainId: z.number().int().positive(),
            })
            .optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const email = input?.email?.trim() || null;
      const wallet = input?.wallet;

      // Privacy: never reveal whether an email is registered. If the email
      // belongs to another account, no-op locally and dispatch an alert to
      // the address out-of-band. The orphaned anonymous user gets reaped by
      // background TTL. The response is indistinguishable from success so
      // an attacker can't enumerate by iterating emails.
      if (email && (await emailBelongsToAnotherAccount(email, ctx.userId))) {
        // Throttle alerts per recipient (1/hour) so the channel can't be
        // weaponized to flood a victim's inbox via sign-up iteration.
        const alertKey = hashIdentifier(email);
        if (accountAlertLimiter.check(alertKey).limited) {
          ctx.log.debug(
            { event: "alert_throttled", emailHash: alertKey },
            "account-exists alert throttled"
          );
        } else {
          sendAccountExistsAlert({
            email,
            signInUrl: `${getAppOrigin()}/sign-in`,
          }).catch((alertError: unknown) => {
            logError(alertError, {
              requestId: ctx.requestId,
              path: "signUp.completeAccountCreation.alert",
            });
          });
        }
        return { success: true };
      }

      // Clean up stale anonymous users from previous incomplete signup attempts
      if (email) {
        await deleteStaleAnonymousUserByEmail(email, ctx.userId);
      }

      let identityUpdate: Promise<void>;
      if (email) {
        identityUpdate = updateUserEmail(ctx.userId, email);
      } else if (wallet) {
        identityUpdate = updateUserWalletIdentity(ctx.userId, wallet.address);
      } else {
        identityUpdate = clearAnonymousFlag(ctx.userId);
      }

      try {
        await Promise.all([
          identityUpdate,
          wallet
            ? linkWalletAddress({
                userId: ctx.userId,
                address: wallet.address,
                chainId: wallet.chainId,
                isPrimary: true,
              })
            : Promise.resolve(),
          upsertIdentityBundle({
            userId: ctx.userId,
            validityStatus: "pending",
            issuerId: BUNDLE_ISSUER_ID,
            policyVersion: BUNDLE_POLICY_VERSION,
            walletAddress: wallet?.address ?? null,
          }),
        ]);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          // Privacy belt-and-suspenders. The email pre-check handles the
          // common case; this catches a TOCTOU race or any other unique
          // collision (e.g., wallet address). Log richly for the operator,
          // but return the same success shape so the response itself never
          // confirms or denies that an identifier is taken.
          logError(error, {
            requestId: ctx.requestId,
            path: "signUp.completeAccountCreation",
          });
          return { success: true };
        }
        throw error;
      }

      if (email) {
        auth.api
          .sendVerificationEmail({
            body: { email, callbackURL: "/dashboard" },
          })
          .catch(() => undefined);
      }

      return { success: true };
    }),
});
