function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function parseOAuthJsonResponse(
  response: Response,
  context: string
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      `${context} failed: empty response body (${response.status} ${response.statusText})`
    );
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `${context} failed: expected a JSON object (${response.status} ${response.statusText})`
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const snippet = compactSnippet(text);
      throw new Error(
        `${context} failed: invalid JSON response (${response.status} ${response.statusText})${snippet ? `: ${snippet}` : ""}`
      );
    }
    throw error;
  }
}

export function describeOAuthErrorResponse(
  response: Response,
  payload: Record<string, unknown>,
  context: string
): string {
  const error =
    typeof payload.error === "string" && payload.error
      ? payload.error
      : response.statusText || "request failed";
  const description =
    typeof payload.error_description === "string" && payload.error_description
      ? payload.error_description
      : null;

  return `${context} failed (${response.status}): ${description ? `${error} - ${description}` : error}`;
}
