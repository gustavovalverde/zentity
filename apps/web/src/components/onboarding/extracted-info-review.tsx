"use client";

import { memo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { calculateAge } from "@/lib/identity/date-utils";

interface ExtractedInfoReviewProps {
  /** User's email address */
  email: string | null;
  /** Extracted name from ID document */
  extractedName: string | null;
  /** Extracted date of birth */
  extractedDOB: string | null;
  /** Extracted nationality */
  extractedNationality: string | null;
  /** Whether ID document was uploaded */
  hasIdDocument: boolean;
  /** Whether selfie/liveness was completed */
  hasSelfie: boolean;
}

/**
 * Displays a summary of extracted information for user review.
 *
 * Shows email, name, DOB (with age badge), nationality, and
 * document/liveness status before account creation.
 *
 * Memoized to prevent re-renders when parent state changes but props remain the same.
 * (rerender-memo optimization)
 */
export const ExtractedInfoReview = memo(function ExtractedInfoReview({
  email,
  extractedName,
  extractedDOB,
  extractedNationality,
  hasIdDocument,
  hasSelfie,
}: ExtractedInfoReviewProps) {
  const age = calculateAge(extractedDOB);

  return (
    <div className="rounded-lg border p-4">
      <h4 className="mb-4 font-medium text-muted-foreground text-sm uppercase tracking-wide">
        Your Information
      </h4>

      <ItemGroup>
        <Item size="sm">
          <ItemContent>
            <ItemDescription>Email</ItemDescription>
            <ItemTitle>{email || "Not provided"}</ItemTitle>
          </ItemContent>
        </Item>

        <ItemSeparator />

        <Item size="sm">
          <ItemContent>
            <ItemDescription>Name</ItemDescription>
            <ItemTitle>{extractedName || "Not extracted"}</ItemTitle>
          </ItemContent>
        </Item>

        <ItemSeparator />

        <Item size="sm">
          <ItemContent>
            <ItemDescription>Date of Birth</ItemDescription>
            <ItemTitle>{extractedDOB || "Not extracted"}</ItemTitle>
          </ItemContent>
          {age !== null ? (
            <ItemActions>
              <Badge variant="secondary">{age}+ years</Badge>
            </ItemActions>
          ) : null}
        </Item>

        <ItemSeparator />

        <Item size="sm">
          <ItemContent>
            <ItemDescription>Nationality</ItemDescription>
            <ItemTitle>{extractedNationality || "Not extracted"}</ItemTitle>
          </ItemContent>
        </Item>

        <ItemSeparator />

        <Item size="sm">
          <ItemContent>
            <ItemDescription>Document</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant={hasIdDocument ? "default" : "outline"}>
              {hasIdDocument ? "Uploaded" : "Skipped"}
            </Badge>
          </ItemActions>
        </Item>

        <ItemSeparator />

        <Item size="sm">
          <ItemContent>
            <ItemDescription>Liveness</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant={hasSelfie ? "default" : "outline"}>
              {hasSelfie ? "Verified" : "Skipped"}
            </Badge>
          </ItemActions>
        </Item>
      </ItemGroup>
    </div>
  );
});
