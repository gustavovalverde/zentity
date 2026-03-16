/**
 * Shared service-token header builder for HTTP transport.
 *
 * In HTTP mode the MCP server acts as a resource server — it doesn't own
 * a DPoP keypair. Downstream calls to Zentity use an internal service token
 * plus user ID header instead of OAuth/DPoP.
 */

export function getServiceTokenHeaders(userId: string): Record<string, string> {
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!serviceToken) {
    throw new Error(
      "INTERNAL_SERVICE_TOKEN required for HTTP transport downstream calls"
    );
  }

  return {
    "X-Zentity-Internal-Token": serviceToken,
    "X-Zentity-User-Id": userId,
  };
}
