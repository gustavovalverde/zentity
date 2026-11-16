import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { pairwiseSubjects } from "@/lib/db/schema/oauth-provider";

type PairwiseSubjectType = "user";

interface PairwiseSubjectIndexEntry {
  sector: string;
  sub: string;
  subjectId: string;
  subjectType: PairwiseSubjectType;
}

interface ResolvePairwiseSubjectIdOptions {
  sector: string;
  sub: string;
  subjectType: PairwiseSubjectType;
}

export async function upsertPairwiseSubjectIndex(
  entry: PairwiseSubjectIndexEntry
): Promise<void> {
  await db.insert(pairwiseSubjects).values(entry).onConflictDoNothing().run();
}

export async function resolvePairwiseSubjectId(
  options: ResolvePairwiseSubjectIdOptions
): Promise<string | null> {
  const indexed = await db
    .select({ subjectId: pairwiseSubjects.subjectId })
    .from(pairwiseSubjects)
    .where(
      and(
        eq(pairwiseSubjects.sector, options.sector),
        eq(pairwiseSubjects.sub, options.sub),
        eq(pairwiseSubjects.subjectType, options.subjectType)
      )
    )
    .limit(1)
    .get();

  return indexed?.subjectId ?? null;
}

/** Removes the user's pairwise rows. */
export async function deletePairwiseSubjectsForUser(
  userId: string
): Promise<void> {
  await db
    .delete(pairwiseSubjects)
    .where(
      and(
        eq(pairwiseSubjects.subjectType, "user"),
        eq(pairwiseSubjects.subjectId, userId)
      )
    )
    .run();
}
