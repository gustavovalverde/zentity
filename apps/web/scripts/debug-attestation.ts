import process from "node:process";

const baseUrl = process.env.DEBUG_BASE_URL || "http://localhost:3000";

async function getSessionCookie(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { accept: "application/json" },
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("No session cookie returned. Make sure you're signed in.");
  }
  return cookie.split(";")[0];
}

async function fetchTrpc(cookie: string): Promise<unknown> {
  const url = `${baseUrl}/api/trpc/attestation.networks?batch=1&input=${encodeURIComponent(
    JSON.stringify({
      0: { json: null },
    })
  )}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      cookie,
    },
  });
  const json = await res.json();
  return json;
}

async function main() {
  try {
    const cookie = await getSessionCookie();
    const data = await fetchTrpc(cookie);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main().catch(() => {
  // intentionally ignored
});
