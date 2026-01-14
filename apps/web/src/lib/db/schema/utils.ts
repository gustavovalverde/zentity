import { sql } from "drizzle-orm";

export const defaultId = sql`(lower(hex(randomblob(16))))`;
