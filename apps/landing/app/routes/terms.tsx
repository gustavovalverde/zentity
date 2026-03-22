import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { LegalLayout, stripH1 } from "@/components/legal-layout";

export const meta: MetaFunction = () => [
  { title: "Terms of Service | Zentity" },
  {
    name: "description",
    content: "Terms for using the Zentity platform.",
  },
];

export async function loader() {
  const filePath = resolve(
    import.meta.dirname,
    "../../../../docs/legal/terms-of-service.md",
  );
  const raw = await readFile(filePath, "utf-8");
  return { content: stripH1(raw) };
}

export default function TermsPage() {
  const { content } = useLoaderData<typeof loader>();
  return <LegalLayout title="Terms of Service" content={content} />;
}
