"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * Route labels for breadcrumb display.
 * Maps URL paths to human-readable labels.
 */
const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/verification": "Verification Status",
  "/dashboard/attestation": "On-Chain Attestation",
  "/dashboard/defi-demo": "DeFi Demo",
  "/dashboard/settings": "Settings",
  "/dashboard/dev": "Debug Tools",
  "/dashboard/dev/rp": "RP Integration",
  "/dashboard/dev/exchange": "Exchange Demo",
};

/**
 * Parent route mappings for building breadcrumb hierarchy.
 */
const PARENT_ROUTES: Record<string, string> = {
  "/dashboard/dev/rp": "/dashboard/dev",
  "/dashboard/dev/exchange": "/dashboard/dev",
};

export function DynamicBreadcrumb() {
  const pathname = usePathname();

  // Get the label for current route
  const currentLabel = ROUTE_LABELS[pathname] || "Dashboard";

  // Build breadcrumb trail
  const breadcrumbs: Array<{
    label: string;
    href: string;
    isCurrent: boolean;
  }> = [];

  // Always start with Dashboard
  if (pathname !== "/dashboard") {
    breadcrumbs.push({
      label: "Dashboard",
      href: "/dashboard",
      isCurrent: false,
    });
  }

  // Add parent route if exists
  const parentPath = PARENT_ROUTES[pathname];
  if (parentPath) {
    breadcrumbs.push({
      label: ROUTE_LABELS[parentPath] || "Development",
      href: parentPath,
      isCurrent: false,
    });
  }

  // Add current page
  breadcrumbs.push({
    label: currentLabel,
    href: pathname,
    isCurrent: true,
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.href}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.isCurrent ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
