import z from "zod";

/**
 * Sign-up schemas
 *
 * Sign-up is intentionally minimal:
 * - Step 1: Email (optional, for recovery)
 * - Step 2: Create account (passkey or password / OPAQUE)
 */
export const emailSchema = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
});
