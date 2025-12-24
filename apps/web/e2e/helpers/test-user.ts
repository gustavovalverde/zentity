import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readTestUserId(): string | null {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const authFile = path.join(currentDir, "..", ".auth", "user.json");
    const raw = fs.readFileSync(authFile, "utf8");
    const json = JSON.parse(raw) as {
      cookies?: Array<{ name: string; value: string }>;
    };
    const sessionCookie = json.cookies?.find(
      (cookie) => cookie.name === "better-auth.session_data",
    );
    if (!sessionCookie?.value) return null;
    const decoded = JSON.parse(
      Buffer.from(sessionCookie.value, "base64").toString("utf8"),
    ) as {
      session?: { user?: { id?: string } };
    };
    return decoded?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
