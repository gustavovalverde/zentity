"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export function SignOutButton() {
  const handleSignOut = async () => {
    await signOut();
    window.location.assign("/");
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut}>
      Sign Out
    </Button>
  );
}
