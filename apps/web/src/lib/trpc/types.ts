/**
 * tRPC Type Utilities
 *
 * Provides type inference helpers for router outputs.
 * Use these types to derive component props directly from API responses,
 * ensuring type safety without manual type maintenance.
 *
 * @example
 * // Infer the response type from a procedure
 * type VerifyResponse = RouterOutputs["identity"]["verify"];
 *
 * // Type component props from API
 * type Props = { data: RouterOutputs["attestation"]["getNetworks"][number] };
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./routers/app";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
