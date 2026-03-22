import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { useLoaderData } from "react-router";

import { getMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source.server";

export async function loader({ params }: { params: { "*": string } }) {
  const slug = params["*"] ?? "";

  if (!slug) {
    throw new Response(null, {
      status: 302,
      headers: { Location: "/docs/architecture" },
    });
  }

  const slugs = slug.split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);

  if (!page) {
    throw new Response("Not found", { status: 404 });
  }

  return {
    path: page.path,
    url: page.url,
    pageTree: await source.serializePageTree(source.pageTree),
  };
}

const docsClientLoader = browserCollections.docs.createClientLoader({
  component(loaded, _props) {
    const { toc, frontmatter, default: Mdx } = loaded;
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <Mdx components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function DocsRoute() {
  const data = useLoaderData<typeof loader>();
  const { path, pageTree } = useFumadocsLoader(data);

  return (
    <DocsLayout tree={pageTree} {...baseOptions()}>
      {docsClientLoader.useContent(path)}
    </DocsLayout>
  );
}
