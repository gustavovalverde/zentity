import {
  IconBrandGithub,
  IconDeviceDesktop,
  IconMenu2,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "#how-it-works", label: "How It Works" },
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Use Cases" },
  { href: "/docs", label: "Docs" },
];

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Toggle theme" />
        }
      >
        {resolvedTheme === "dark" ? (
          <IconSun className="size-5" />
        ) : (
          <IconMoon className="size-5" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <IconSun className="size-4" />
          Light
          {theme === "light" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <IconMoon className="size-4" />
          Dark
          {theme === "dark" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <IconDeviceDesktop className="size-4" />
          System
          {theme === "system" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Nav() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 right-0 left-0 z-50 transition-[color,background-color,box-shadow,border-color] duration-300",
        isScrolled
          ? "border-border border-b bg-background/80 shadow-sm backdrop-blur-md"
          : "bg-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center" aria-label="Zentity Home">
            <Logo variant="full" size="sm" />
          </a>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            Alpha
          </Badge>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) =>
            link.href.startsWith("/") ? (
              <Link
                key={link.href}
                to={link.href}
                className="rounded-sm font-medium text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className="rounded-sm font-medium text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {link.label}
              </a>
            ),
          )}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            render={
              /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
              <a
                href="https://github.com/gustavovalverde/zentity"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              />
            }
          >
            <IconBrandGithub className="mr-2 size-4" />
            GitHub
          </Button>
          <Button
            size="sm"
            render={
              /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
              <a
                href="https://app.zentity.xyz/sign-up?fresh=1"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Try Demo"
              />
            }
          >
            Try Demo
          </Button>
        </div>

        {/* Mobile Menu */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="sm" aria-label="Toggle menu" />
              }
            >
              <IconMenu2 className="size-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="mt-4 flex flex-col gap-1">
                {navLinks.map((link) =>
                  link.href.startsWith("/") ? (
                    <Link
                      key={link.href}
                      to={link.href}
                      onClick={() => setIsSheetOpen(false)}
                      className="block rounded-md px-2 py-2 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsSheetOpen(false)}
                      className="block rounded-md px-2 py-2 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.label}
                    </a>
                  ),
                )}
              </nav>
              <div className="mt-6 flex flex-col gap-2 border-border border-t pt-4">
                <Button
                  variant="outline"
                  className="w-full"
                  render={
                    /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
                    <a
                      href="https://github.com/gustavovalverde/zentity"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View on GitHub"
                    />
                  }
                >
                  <IconBrandGithub className="mr-2 size-4" />
                  View on GitHub
                </Button>
                <Button
                  className="w-full"
                  render={
                    /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
                    <a
                      href="https://app.zentity.xyz/sign-up?fresh=1"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Try Demo"
                    />
                  }
                >
                  Try Demo
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
