import { OAuthConsentClient } from "./consent-client";

export default function OAuthConsentPage({
  searchParams,
}: Readonly<{
  searchParams?: { client_id?: string; scope?: string };
}>) {
  return (
    <OAuthConsentClient
      clientId={searchParams?.client_id ?? null}
      scopeParam={searchParams?.scope ?? ""}
    />
  );
}
