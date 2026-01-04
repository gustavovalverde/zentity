import { IconBrandGithub, IconBrandX } from "@tabler/icons-react";

const footerLinks = {
  product: [
    { label: "Features", href: "#features" },
    { label: "Use Cases", href: "#use-cases" },
    { label: "How It Works", href: "#how-it-works" },
  ],
  developers: [
    {
      label: "Documentation",
      href: "https://github.com/gustavovalverde/zentity/tree/main/docs",
      external: true,
    },
    {
      label: "GitHub",
      href: "https://github.com/gustavovalverde/zentity",
      external: true,
    },
    {
      label: "Architecture",
      href: "https://github.com/gustavovalverde/zentity/blob/main/docs/architecture.md",
      external: true,
    },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ],
};

export function Footer() {
  return (
    <footer className="border-border border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-1">
            <span className="font-bold text-xl">Zentity</span>
            <p className="mt-4 text-muted-foreground text-sm">
              Privacy-first identity verification powered by zero-knowledge
              cryptography.
            </p>
            <div className="mt-4 flex gap-4">
              <a
                href="https://github.com/gustavovalverde/zentity"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="GitHub"
              >
                <IconBrandGithub className="size-5" />
              </a>
              <a
                href="https://x.com/gustavovalverde"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="X (Twitter)"
              >
                <IconBrandX className="size-5" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="mb-4 font-semibold text-sm">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Developer Links */}
          <div>
            <h3 className="mb-4 font-semibold text-sm">Developers</h3>
            <ul className="space-y-3">
              {footerLinks.developers.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    {...(link.external && {
                      target: "_blank",
                      rel: "noopener noreferrer",
                    })}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="mb-4 font-semibold text-sm">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-border border-t pt-8">
          <p className="text-center text-muted-foreground text-sm">
            &copy; {new Date().getFullYear()} Zentity. Open source under{" "}
            <a
              href="https://osaasy.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline transition-colors hover:text-foreground"
            >
              O'Saasy License
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
