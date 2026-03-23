"use client";

import { Badge } from "@/components/ui/badge";

const TIER_RE = /tier-(\d)/;

const AMR_LABELS: Record<string, string> = {
  pwd: "Password",
  hwk: "Hardware Key",
  swk: "Software Key",
  face: "Face",
  fpt: "Fingerprint",
  pop: "Proof-of-Possession",
  wia: "Wallet",
  sc: "Smart Card",
};

function formatAmr(methods: string[]): string {
  return methods.map((m) => AMR_LABELS[m] ?? m).join(", ");
}

export function AssuranceBadges({
  claims,
}: {
  claims: Record<string, unknown> | undefined;
}) {
  if (!claims) {
    return null;
  }

  const acr = claims.acr as string | undefined;
  const amr = claims.amr as string[] | undefined;
  const emailVerified =
    typeof claims.email_verified === "boolean"
      ? claims.email_verified
      : undefined;

  const tierMatch = acr?.match(TIER_RE);
  const tierLabel = tierMatch ? `Tier ${tierMatch[1]}` : undefined;
  const amrLabel = amr?.length ? formatAmr(amr) : undefined;

  if (!(tierLabel || amrLabel || emailVerified !== undefined)) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tierLabel && (
        <Badge
          className="border-primary/30 text-primary hover:bg-primary/10"
          variant="outline"
        >
          {tierLabel}
        </Badge>
      )}
      {amrLabel && (
        <Badge
          className="bg-primary/10 text-primary hover:bg-primary/15"
          variant="secondary"
        >
          Auth: {amrLabel}
        </Badge>
      )}
      {emailVerified !== undefined && (
        <Badge
          className={
            emailVerified
              ? "border-green-500/30 text-green-600 hover:bg-green-500/10"
              : "border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
          }
          variant="outline"
        >
          {emailVerified ? "Email Verified" : "Email Unverified"}
        </Badge>
      )}
    </div>
  );
}
