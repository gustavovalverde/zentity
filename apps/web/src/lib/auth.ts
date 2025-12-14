import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned, magicLink } from "better-auth/plugins";
import { getBetterAuthSecret } from "@/lib/env";
import { getDefaultDatabasePath, getSqliteDb } from "@/lib/sqlite";

const db = getSqliteDb(getDefaultDatabasePath());

export const auth = betterAuth({
  database: db,
  secret: getBetterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Disable for dev, enable in production
    minPasswordLength: 10,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user: _user, url: _url }) => {
      // TODO: Implement email sending when SMTP is configured
      // For now, silently succeed - the user won't receive an email but can retry
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
    haveIBeenPwned(),
    magicLink({
      sendMagicLink: async ({ email: _email, url: _url }) => {
        // TODO: Implement email sending when SMTP is configured
        // For now, silently succeed - the user won't receive an email but can retry
      },
      expiresIn: 300, // 5 minutes
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
