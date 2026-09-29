import type { User as BetterAuthUser } from "better-auth";

interface OpaquePasswordResetOptions {
  /**
   * Callback invoked after a successful password reset.
   */
  onPasswordReset?: (
    data: { user: BetterAuthUser },
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
   * Send password reset instructions to the user.
   */
  sendResetPassword: (
    data: { user: BetterAuthUser; url: string; token: string },
    request?: Request
  ) => Promise<void>;
}

export interface OpaquePluginOptions
  extends Partial<OpaquePasswordResetOptions> {
  /**
   * OPAQUE server setup string or a getter function that returns it.
   * Using a getter function allows lazy evaluation (deferred until runtime),
   * which is necessary for Next.js builds where env vars may not be available.
   * Generate with: npx @serenity-kit/opaque@latest create-server-setup
   */
  serverSetup: string | (() => string);
}

export interface OpaqueClientOptions {
  /**
   * If true, throw when server public key mismatches.
   * Defaults to true. The public key is fetched from the API automatically.
   */
  enforceServerPublicKey?: boolean;
  /**
   * Optional server public key for OPAQUE pinning.
   * Prefer setting via NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY in production.
   */
  serverPublicKey?: string;
}
