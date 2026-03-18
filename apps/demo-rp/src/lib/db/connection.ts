import "server-only";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "@/lib/env";

import {
  account,
  cibaPings,
  dcrClient,
  session,
  user,
  verification,
  vpSessions,
} from "./schema";

const dbSchema = {
  account,
  cibaPings,
  dcrClient,
  session,
  user,
  verification,
  vpSessions,
};

function createDb() {
  const client = createClient({
    url: env.DATABASE_URL,
    ...(env.DATABASE_AUTH_TOKEN === undefined
      ? {}
      : { authToken: env.DATABASE_AUTH_TOKEN }),
  });
  return drizzle(client, { schema: dbSchema });
}

type Db = ReturnType<typeof createDb>;
let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}
