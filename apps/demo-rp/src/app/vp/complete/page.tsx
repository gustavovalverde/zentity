import { cookies } from "next/headers";
import Link from "next/link";

import { getVpSession } from "@/lib/oid4vp";

export default async function VpCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="space-y-4 text-center">
          <h1 className="font-bold text-2xl">Invalid Request</h1>
          <p className="text-muted-foreground">Missing session identifier.</p>
          <Link className="text-primary underline" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  const session = await getVpSession(sessionId);

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="space-y-4 text-center">
          <h1 className="font-bold text-2xl">Session Not Found</h1>
          <p className="text-muted-foreground">
            The verification session has expired or does not exist.
          </p>
          <Link className="text-primary underline" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  // Same-device session binding: validate the session cookie matches
  const cookieStore = await cookies();
  const currentCookie = cookieStore.get("demo-rp.session_token")?.value ?? null;

  if (session.sessionCookie && currentCookie !== session.sessionCookie) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="space-y-4 text-center">
          <h1 className="font-bold text-2xl">Session Mismatch</h1>
          <p className="text-muted-foreground">
            This verification was initiated from a different session.
          </p>
          <Link className="text-primary underline" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  if (session.status !== "verified") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="space-y-4 text-center">
          <h1 className="font-bold text-2xl">Verification {session.status}</h1>
          <p className="text-muted-foreground">
            {session.status === "pending"
              ? "Waiting for wallet response..."
              : session.status === "expired"
                ? "This session has expired."
                : "Verification failed. Please try again."}
          </p>
          <Link className="text-primary underline" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  const claims = session.result ? JSON.parse(session.result) : {};

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="font-bold text-2xl">Verification Complete</h1>
          <p className="text-muted-foreground">
            Credential successfully verified.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold text-sm">Disclosed Claims</h2>
          <div className="space-y-2">
            {Object.entries(claims).map(([key, value]) => (
              <div
                className="flex items-center justify-between text-sm"
                key={key}
              >
                <span className="text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </span>
                <span className="font-mono">
                  {typeof value === "boolean"
                    ? value
                      ? "Yes"
                      : "No"
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <Link className="block text-center text-primary underline" href="/">
          Return home
        </Link>
      </div>
    </div>
  );
}
