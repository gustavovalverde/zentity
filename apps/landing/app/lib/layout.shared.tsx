import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";

export function baseOptions(): Partial<DocsLayoutProps> {
  return {
    nav: {
      title: "Zentity",
      url: "/",
    },
    githubUrl: "https://github.com/gustavovalverde/zentity",
  };
}
