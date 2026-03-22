import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { LegalLayout, stripH1 } from "@/components/legal-layout";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | Zentity" },
  {
    name: "description",
    content: "How Zentity collects, uses, and protects your data.",
  },
];

export async function loader() {
  const filePath = resolve(
    import.meta.dirname,
    "../../../../docs/legal/privacy-policy.md",
  );
  const raw = await readFile(filePath, "utf-8");
  return { content: stripH1(raw) };
}

export default function PrivacyPage() {
  const { content } = useLoaderData<typeof loader>();
  return <LegalLayout title="Privacy Policy" content={content} />;
}
