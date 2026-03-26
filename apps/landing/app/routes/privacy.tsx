import { privacy } from "virtual:markdown-content";
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
  return { content: stripH1(privacy) };
}

export default function PrivacyPage() {
  const { content } = useLoaderData<typeof loader>();
  return <LegalLayout title="Privacy Policy" content={content} />;
}
