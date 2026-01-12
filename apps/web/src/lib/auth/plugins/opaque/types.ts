import type {
  Account as BetterAuthAccount,
  User as BetterAuthUser,
} from "better-auth";

export interface OpaqueResolvedUser {
  user: BetterAuthUser;
  accounts: BetterAuthAccount[];
}

/**
 * Flexible context type for OPAQUE operations.
 * Uses a permissive type to avoid conflicts with better-auth's strict internal types.
 */
export interface OpaqueEndpointContext {
  context: {
    internalAdapter: {
      findUserByEmail: (
        email: string,
        options?: { includeAccounts: boolean }
      ) => Promise<OpaqueResolvedUser | null>;
      findUserById: (id: string) => Promise<BetterAuthUser | null>;
      findAccounts: (userId: string) => Promise<BetterAuthAccount[]>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

export type ResolveUserByIdentifier = (
  identifier: string,
  ctx: OpaqueEndpointContext
) => Promise<OpaqueResolvedUser | null>;

export interface OpaquePasswordResetOptions {
  /**
   * Send password reset instructions to the user.
   */
  sendResetPassword: (
    data: { user: BetterAuthUser; url: string; token: string },
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
    data: { user: BetterAuthUser },
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
  /**
   * Resolve a user + accounts from a login identifier (email or recovery ID).
   * If omitted, we fall back to email lookup only.
   */
  resolveUserByIdentifier?: ResolveUserByIdentifier;
}

export interface OpaqueClientOptions {
  /**
   * Optional server public key for OPAQUE pinning.
   * Prefer setting via NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY in production.
   */
  serverPublicKey?: string;
  /**
   * If true, throw when server public key mismatches.
   * Defaults to true. The public key is fetched from the API automatically.
   */
  enforceServerPublicKey?: boolean;
}
