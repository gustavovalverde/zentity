import {
  IconBrandGithub,
  IconDeviceDesktop,
  IconMenu2,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
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
  { href: "/", label: "Home" },
  { href: "/zk-auth", label: "ZK-Auth" },
  { href: "/compliance", label: "Compliance" },
  { href: "/interoperability", label: "Standards" },
  { href: "/docs/attestation-privacy", label: "Privacy Model" },
  { href: "/docs/architecture", label: "Docs" },
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
  const location = useLocation();
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
      <nav className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <div className="flex flex-1 items-center justify-start">
          <a href="/" className="flex items-center" aria-label="Zentity Home">
            <Logo variant="full" size="sm" />
          </a>
        </div>

        {/* Desktop Navigation */}
        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            {navLinks.map((link) => (
              <NavigationMenuItem key={link.href}>
                <NavigationMenuLink
                  active={location.pathname === link.href}
                  render={<Link to={link.href} />}
                >
                  {link.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="hidden flex-1 items-center justify-end gap-3 md:flex">
          <ThemeToggle />
          <a
            href="https://github.com/gustavovalverde/zentity"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-8",
            )}
          >
            <IconBrandGithub className="size-4" />
          </a>
          <a
            href="https://app.zentity.xyz/sign-up?fresh=1"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Explore the Demo"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Explore the Demo
          </a>
        </div>

        {/* Mobile Menu */}
        <div className="flex flex-1 items-center justify-end gap-2 md:hidden">
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
                <a
                  href="https://app.zentity.xyz/sign-up?fresh=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Explore the Demo"
                  className={cn(buttonVariants(), "w-full")}
                >
                  Explore the Demo
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
