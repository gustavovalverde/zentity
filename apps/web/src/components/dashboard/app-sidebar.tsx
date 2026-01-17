"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Code,
  Coins,
  FileCheck2,
  LogOut,
  Settings,
  Shield,
  TestTube,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { ProfileGreetingName } from "@/components/dashboard/profile-greeting";
import { Logo } from "@/components/logo";
import { usePasskeyAuth } from "@/components/providers/passkey-auth-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { completeSignOut } from "@/lib/auth/session-manager";
import { isWeb3Enabled } from "@/lib/feature-flags";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AppSidebarProps {
  user: {
    email?: string | null;
  };
}

const identityNavItems: NavItem[] = [
  {
    title: "My Identity",
    url: "/dashboard",
    icon: Shield,
  },
  {
    title: "Credentials",
    url: "/dashboard/credentials",
    icon: FileCheck2,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
];

const blockchainNavItems: NavItem[] = [
  {
    title: "On-Chain Attestation",
    url: "/dashboard/attestation",
    icon: Shield,
  },
  {
    title: "DeFi Demo",
    url: "/dashboard/defi-demo",
    icon: Coins,
  },
];

const developmentNavItems: NavItem[] = [
  {
    title: "Exchange Demo",
    url: "/dashboard/dev/exchange",
    icon: TestTube,
  },
  {
    title: "Debug Tools",
    url: "/dashboard/dev",
    icon: Code,
  },
];

export function AppSidebar({ user }: Readonly<AppSidebarProps>) {
  const pathname = usePathname();
  const router = useRouter();
  const web3Enabled = isWeb3Enabled();
  const queryClient = useQueryClient();
  const { clear: clearPrfOutput } = usePasskeyAuth();
  const prefetchedRef = useRef<Set<string>>(new Set());

  const handleSignOut = async () => {
    await completeSignOut({
      queryClient,
      onClearPrf: clearPrfOutput,
    });
  };

  const isActive = (url: string) => {
    if (url === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(url);
  };

  // Prefetch on hover for faster navigation (deduplicated)
  const handlePrefetch = useCallback(
    (url: string) => {
      if (!prefetchedRef.current.has(url)) {
        prefetchedRef.current.add(url);
        router.prefetch(url);
      }
    },
    [router]
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/dashboard">
                <Logo size="sm" variant="icon" />
                <span className="font-semibold">Zentity</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Identity Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Identity</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {identityNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link
                      href={item.url}
                      onMouseEnter={() => handlePrefetch(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Blockchain Section - Only shown when Web3 is enabled */}
        {web3Enabled ? (
          <SidebarGroup>
            <SidebarGroupLabel>Blockchain</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {blockchainNavItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                    >
                      <Link
                        href={item.url}
                        onMouseEnter={() => handlePrefetch(item.url)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Development Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Development</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {developmentNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link
                      href={item.url}
                      onMouseEnter={() => handlePrefetch(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Settings">
              <Link
                href="/dashboard/settings"
                onMouseEnter={() => handlePrefetch("/dashboard/settings")}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex flex-col truncate">
                  <span className="truncate font-medium text-sm">
                    <ProfileGreetingName fallback="User" />
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {user.email}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
