import { redirect } from "next/navigation";

/**
 * Verification page redirect.
 *
 * The verification status is now shown on the main dashboard page.
 * This redirect ensures backwards compatibility for bookmarks and links.
 */
export default function VerificationPage() {
  redirect("/dashboard");
}
