"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Nav() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 right-0 left-0 z-50 transition-[color,background-color,box-shadow,border-color] duration-300",
        isScrolled
          ? "border-border border-b bg-background/80 shadow-sm backdrop-blur-md"
          : "bg-transparent"
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <a aria-label="Zentity Home" className="flex items-center" href="/">
          <Image
            alt="Zentity"
            className="object-contain dark:invert"
            height={36}
            src="/images/logo/logo.svg"
            width={66}
          />
        </a>

        <a
          className={cn(buttonVariants({ size: "sm" }))}
          href="https://app.zentity.xyz/sign-up?fresh=1"
          rel="noopener noreferrer"
          target="_blank"
        >
          Sign Up for Zentity
        </a>
      </nav>
    </header>
  );
}
