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
import { calculateAge } from "@/lib/identity/verification/date-utils";

interface ExtractedInfoReviewProps {
  /** User's email address (from store or session) */
  email: string | null;
  /** Whether this is an anonymous account */
  isAnonymous?: boolean;
  /** Extracted name from ID document */
  extractedName: string | null;
  /** Extracted date of birth */
  extractedDOB: string | null;
  /** Extracted nationality */
  extractedNationality: string | null;
}

/**
 * Displays a summary of extracted information for user review.
 *
 * Shows email, name, DOB (with age badge), and nationality before account creation.
 *
 * Memoized to prevent re-renders when parent state changes but props remain the same.
 */
export const ExtractedInfoReview = memo(function ExtractedInfoReview({
  email,
  isAnonymous = false,
  extractedName,
  extractedDOB,
  extractedNationality,
}: Readonly<ExtractedInfoReviewProps>) {
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
            <ItemTitle className={isAnonymous ? "font-mono text-sm" : ""}>
              {email || "Not provided"}
            </ItemTitle>
          </ItemContent>
          {isAnonymous ? (
            <ItemActions>
              <Badge variant="secondary">Anonymous</Badge>
            </ItemActions>
          ) : null}
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
      </ItemGroup>
    </div>
  );
});
