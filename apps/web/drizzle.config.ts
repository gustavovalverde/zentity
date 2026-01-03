const rawPath = process.env.DATABASE_PATH || "./.data/dev.db";

let url = rawPath;
if (rawPath === ":memory:") {
  url = "file::memory:";
} else if (rawPath.startsWith("file:") || rawPath.startsWith("libsql:")) {
  url = rawPath;
} else {
  url = `file:${rawPath}`;
}

const config = {
  schema: "./src/lib/db/schema/index.ts",
  dialect: "sqlite",
  dbCredentials: {
    url,
  },
};

export default config;
