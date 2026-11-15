const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";

export default {
  schema: "./src/lib/db/schema/*.ts",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
};
