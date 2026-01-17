const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export default {
  schema: "./src/lib/db/schema/*.ts",
  dialect: "turso",
  dbCredentials: authToken
    ? {
        url,
        authToken,
      }
    : {
        url,
      },
};
