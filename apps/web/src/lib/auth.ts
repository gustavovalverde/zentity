import * as fs from "node:fs";
import * as path from "node:path";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import Database from "better-sqlite3";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "./email";

// Use DATABASE_PATH env var for Docker volume persistence, default to ./dev.db for local dev
const dbPath = process.env.DATABASE_PATH || "./dev.db";

// Ensure the database directory exists
const dbDir = path.dirname(dbPath);
if (dbDir !== "." && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

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
    sendResetPassword: async ({ user, url }) => {
      // Don't await to prevent timing attacks
      void sendPasswordResetEmail({ email: user.email, url });
    },
  },
  // OAuth providers for account linking (users must complete KYC first)
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      // Enable account linking
      mapProfileToUser: (profile) => ({
        name: profile.name,
        image: profile.picture,
      }),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      // Enable account linking
      mapProfileToUser: (profile) => ({
        name: profile.name || profile.login,
        image: profile.avatar_url,
      }),
    },
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
  plugins: [
    nextCookies(),
    magicLink({
      sendMagicLink: async ({ email, token, url }) => {
        await sendMagicLinkEmail({ email, token, url });
      },
      expiresIn: 300, // 5 minutes
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
