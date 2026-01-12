import type { GenericEndpointContext } from "@better-auth/core";
import type { Account, User } from "better-auth";

export type OpaqueResolvedUser = {
  user: User;
  accounts: Account[];
};

export type ResolveUserByIdentifier = (
  identifier: string,
  ctx: GenericEndpointContext
) => Promise<OpaqueResolvedUser | null>;

export interface OpaquePasswordResetOptions {
  /**
   * Send password reset instructions to the user.
   */
  sendResetPassword: (
    data: { user: User; url: string; token: string },
    request?: Request
  ) => Promise<void>;
  /**
   * Number of seconds the reset token remains valid.
   * @default 3600
   */
  resetPasswordTokenExpiresIn?: number;
  /**
   * Revoke all sessions after a password reset.
   * @default false
   */
  revokeSessionsOnPasswordReset?: boolean;
  /**
   * Callback invoked after a successful password reset.
   */
  onPasswordReset?: (
    data: { user: User },
    request?: Request
  ) => Promise<void>;
}

export interface OpaquePluginOptions extends Partial<OpaquePasswordResetOptions> {
  /**
   * OPAQUE server setup string.
   * Generate with: npx @serenity-kit/opaque@latest create-server-setup
   */
  serverSetup: string;
  /**
   * Resolve a user + accounts from a login identifier (email or recovery ID).
   * If omitted, we fall back to email lookup only.
   */
  resolveUserByIdentifier?: ResolveUserByIdentifier;
}

export interface OpaqueClientOptions {
  /**
   * Optional server public key pinning for OPAQUE.
   */
  serverPublicKey?: string;
  /**
   * If true, throw when server public key mismatches.
   * Defaults to true when serverPublicKey is provided.
   */
  enforceServerPublicKey?: boolean;
}
