"use client";

import {
  Code,
  Coins,
  LayoutDashboard,
  Link as LinkIcon,
  LogOut,
  Settings,
  Shield,
  TestTube,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/logo";
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
import { signOut } from "@/lib/auth";
import { isWeb3Enabled } from "@/lib/feature-flags";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AppSidebarProps {
  user: {
    email?: string | null;
    name?: string | null;
  };
}

const identityNavItems: NavItem[] = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Verification Status",
    url: "/dashboard/verification",
    icon: Shield,
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
    title: "RP Integration",
    url: "/dashboard/dev/rp",
    icon: LinkIcon,
  },
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

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const web3Enabled = isWeb3Enabled();

  const handleSignOut = async () => {
    await signOut();
    window.location.assign("/");
  };

  const isActive = (url: string) => {
    if (url === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(url);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <Logo variant="icon" size="sm" />
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
                    <Link href={item.url}>
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
        {web3Enabled && (
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
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

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
                    <Link href={item.url}>
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
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4" />
              </div>
              <div className="flex flex-col truncate">
                <span className="truncate text-sm font-medium">
                  {user.name || "User"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
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
