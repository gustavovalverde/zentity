import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";

import { auth } from "@/lib/auth/auth-config";
import { getAppOrigin } from "@/lib/auth/origin";
import { isServiceAccountEmail } from "@/lib/auth/service-account";
import { isUniqueConstraintError } from "@/lib/db/errors";
import {
  clearAnonymousFlag,
  deleteStaleAnonymousUserByEmail,
  emailBelongsToAnotherAccount,
  isUserAnonymous,
  isWalletLinkedToUser,
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

export const signUpRouter = router({
  completeAccountCreation: protectedProcedure
    .input(
      z
        .object({
          email: z
            .email()
            .refine((email) => !isServiceAccountEmail(email), {
              message: "This email address can't be used",
            })
            .optional(),
          wallet: z.object({ address: z.string().min(1) }).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      // Completing sign-up sets the account's email and wallet without any
      // other check, so it must not reach an account that already exists.
      if (!(await isUserAnonymous(ctx.userId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This account is already set up.",
        });
      }

      const email = input?.email?.trim() || null;
      const wallet = input?.wallet;
      if (wallet && !(await isWalletLinkedToUser(ctx.userId, wallet.address))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Sign in with this wallet to link it to your account.",
        });
      }

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
          .catch((sendError: unknown) => {
            ctx.log.error(
              {
                event: "verification_email_send_failed",
                emailHash: hashIdentifier(email),
                err: sendError,
              },
              "failed to send verification email"
            );
          });
      }

      return { success: true };
    }),
});
