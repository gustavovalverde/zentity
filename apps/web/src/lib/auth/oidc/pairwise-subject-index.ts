import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { pairwiseSubjects } from "@/lib/db/schema/oauth-provider";

type PairwiseSubjectType = "agent_session" | "user";

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

/**
 * Removes pairwise rows for a user and any agent sessions that user owns.
 */
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

  const ownedSessions = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .innerJoin(agentHosts, eq(agentSessions.hostId, agentHosts.id))
    .where(eq(agentHosts.userId, userId))
    .all();

  const sessionIds = ownedSessions.map((session) => session.id);
  if (sessionIds.length === 0) {
    return;
  }

  await db
    .delete(pairwiseSubjects)
    .where(
      and(
        eq(pairwiseSubjects.subjectType, "agent_session"),
        inArray(pairwiseSubjects.subjectId, sessionIds)
      )
    )
    .run();
}
