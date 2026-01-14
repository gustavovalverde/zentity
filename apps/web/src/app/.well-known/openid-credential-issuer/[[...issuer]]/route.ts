import { auth } from "@/lib/auth/auth";

export async function GET(request: Request) {
  if (!auth.publicHandler) {
    return new Response("Not Found", { status: 404 });
  }

  // Get the original response from better-auth
  const response = await auth.publicHandler(request);
  const metadata = await response.json();

  // Add token_endpoint directly for wallet compatibility (e.g., walt.id)
  // Some wallets expect token_endpoint in the credential issuer metadata
  // rather than looking it up from authorization_servers
  const authServer =
    metadata.authorization_servers?.[0] ?? metadata.credential_issuer;
  const enhancedMetadata = {
    ...metadata,
    token_endpoint: `${authServer}/oauth2/token`,
  };

  return new Response(JSON.stringify(enhancedMetadata), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
