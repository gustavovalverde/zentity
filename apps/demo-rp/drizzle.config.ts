const url = process.env.DATABASE_URL || "file:./.data/demo-rp.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default {
  schema: "./src/lib/db/schema.ts",
  dialect: "turso" as const,
  dbCredentials: { url, authToken },
};
