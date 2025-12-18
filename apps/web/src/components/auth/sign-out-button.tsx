"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut}>
      Sign Out
    </Button>
  );
}
