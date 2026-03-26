import { terms } from "virtual:markdown-content";
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
  return { content: stripH1(terms) };
}

export default function TermsPage() {
  const { content } = useLoaderData<typeof loader>();
  return <LegalLayout title="Terms of Service" content={content} />;
}
