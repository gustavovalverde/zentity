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
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-1">
            <span className="text-xl font-bold">Zentity</span>
            <p className="mt-4 text-sm text-muted-foreground">
              Privacy-first identity verification powered by zero-knowledge
              cryptography.
            </p>
            <div className="mt-4 flex gap-4">
              <a
                href="https://github.com/gustavovalverde/zentity"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="GitHub"
              >
                <IconBrandGithub className="size-5" />
              </a>
              <a
                href="https://x.com/gustavovalverde"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="X (Twitter)"
              >
                <IconBrandX className="size-5" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="text-sm font-semibold mb-4">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Developer Links */}
          <div>
            <h3 className="text-sm font-semibold mb-4">Developers</h3>
            <ul className="space-y-3">
              {footerLinks.developers.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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
            <h3 className="text-sm font-semibold mb-4">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Zentity. Open source under{" "}
            <a
              href="https://osaasy.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors underline"
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
