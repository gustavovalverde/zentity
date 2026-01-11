import "server-only";

import { randomUUID } from "node:crypto";

import {
  CHALLENGE_INSTRUCTIONS,
  type ChallengeInfo,
  type ChallengeType,
} from "./challenges";

interface LivenessSession {
  sessionId: string;
  challenges: ChallengeType[];
  currentIndex: number;
  createdAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000;

// Use globalThis to persist sessions across hot reloads in development
const globalForLiveness = globalThis as unknown as {
  livenessSessionStore: Map<string, LivenessSession> | undefined;
};

const sessions =
  globalForLiveness.livenessSessionStore ?? new Map<string, LivenessSession>();

if (process.env.NODE_ENV !== "production") {
  globalForLiveness.livenessSessionStore = sessions;
}

function cleanupExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
    }
  }
}

export function createLivenessSession(
  numChallenges = 2,
  requireHeadTurn = false
): LivenessSession {
  cleanupExpiredSessions();

  const count = Math.max(2, Math.min(4, numChallenges));
  const available: ChallengeType[] = ["smile", "turn_left", "turn_right"];
  const challenges: ChallengeType[] = [];

  if (requireHeadTurn) {
    const headTurns: ChallengeType[] = ["turn_left", "turn_right"];
    challenges.push(headTurns[Math.floor(Math.random() * headTurns.length)]);
  }

  while (challenges.length < count) {
    const next = available[Math.floor(Math.random() * available.length)];
    if (!challenges.includes(next)) {
      challenges.push(next);
    }
  }

  // Shuffle for unpredictability
  for (let i = challenges.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [challenges[i], challenges[j]] = [challenges[j], challenges[i]];
  }

  const session: LivenessSession = {
    sessionId: randomUUID(),
    challenges,
    currentIndex: 0,
    createdAt: Date.now(),
  };

  sessions.set(session.sessionId, session);
  return session;
}

export function getLivenessSession(
  sessionId: string
): LivenessSession | undefined {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  return session;
}

export function getChallengeInfo(
  session: LivenessSession
): ChallengeInfo | null {
  if (session.currentIndex >= session.challenges.length) {
    return null;
  }
  const challengeType = session.challenges[session.currentIndex];
  const meta = CHALLENGE_INSTRUCTIONS[challengeType];
  return {
    challengeType,
    index: session.currentIndex,
    total: session.challenges.length,
    ...meta,
  };
}
