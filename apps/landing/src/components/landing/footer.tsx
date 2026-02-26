import { IconBrandGithub, IconBrandX } from "@tabler/icons-react";
import { Link } from "react-router-dom";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const footerLinkClasses =
  "rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function FooterLinkItem({ link }: { link: FooterLink }) {
  if (link.external || link.href.startsWith("mailto:")) {
    return (
      <a
        href={link.href}
        className={footerLinkClasses}
        {...(link.external && {
          target: "_blank",
          rel: "noopener noreferrer",
        })}
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link to={link.href} className={footerLinkClasses}>
      {link.label}
    </Link>
  );
}

const footerLinks = {
  product: [
    { label: "Home", href: "/" },
    { label: "Compliance", href: "/compliance" },
    { label: "Standards", href: "/interoperability" },
    { label: "Docs", href: "/docs/architecture" },
  ] satisfies FooterLink[],
  developers: [
    {
      label: "Documentation",
      href: "/docs/architecture",
    },
    {
      label: "GitHub",
      href: "https://github.com/gustavovalverde/zentity",
      external: true,
    },
    {
      label: "Contact",
      href: "mailto:hello@zentity.xyz",
    },
  ] satisfies FooterLink[],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
  ] satisfies FooterLink[],
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
              Privacy-first identity verification powered by ZK and FHE
              cryptography with standards-based OIDC integration.
            </p>
            <div className="mt-4 flex gap-2">
              <a
                href="https://github.com/gustavovalverde/zentity"
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="GitHub"
              >
                <IconBrandGithub className="size-5" />
              </a>
              <a
                href="https://x.com/gustavovalverde"
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <FooterLinkItem link={link} />
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
                  <FooterLinkItem link={link} />
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
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-border border-t pt-8">
          <p className="text-center text-muted-foreground text-sm">
            &copy; {new Date().getFullYear()} Zentity. Licensed under{" "}
            <a
              href="https://osaasy.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm underline transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
