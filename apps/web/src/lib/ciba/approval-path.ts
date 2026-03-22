interface ApprovalPageSearchParams {
  [key: string]: string | string[] | undefined;
}

export function buildStandaloneApprovalPath(
  authReqId: string,
  searchParams: ApprovalPageSearchParams = {}
): string {
  const url = new URL(
    `/approve/${encodeURIComponent(authReqId)}`,
    "http://localhost"
  );

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
      continue;
    }

    url.searchParams.set(key, value);
  }

  return `${url.pathname}${url.search}`;
}
