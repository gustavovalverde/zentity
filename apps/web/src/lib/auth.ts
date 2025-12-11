import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import Database from "better-sqlite3";

const db = new Database("./dev.db");

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("synchronous = normal");

export const auth = betterAuth({
  database: db,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Disable for dev, enable in production
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    // Enable cookie caching with JWE encryption for better performance
    // Reduces database queries by caching session in encrypted cookies
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minute cache
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
