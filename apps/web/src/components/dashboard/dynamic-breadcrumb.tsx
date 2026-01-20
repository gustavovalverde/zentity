"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

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
  "/dashboard": "My Identity",
  "/dashboard/credentials": "Credentials",
  "/dashboard/attestation": "On-Chain Attestation",
  "/dashboard/defi-demo": "DeFi Demo",
  "/dashboard/settings": "Settings",
  "/dashboard/dev": "Debug Tools",
  "/dashboard/dev/exchange": "Exchange Demo",
  "/dashboard/verify": "Verify Identity",
  "/dashboard/verify/document": "Document Upload",
  "/dashboard/verify/liveness": "Liveness Check",
  "/dashboard/verify/face": "Face Match",
  "/dashboard/verify/proofs": "Generate Proofs",
};

/**
 * Parent route mappings for building breadcrumb hierarchy.
 */
const PARENT_ROUTES: Record<string, string> = {
  "/dashboard/dev/exchange": "/dashboard/dev",
  "/dashboard/verify/document": "/dashboard/verify",
  "/dashboard/verify/liveness": "/dashboard/verify",
  "/dashboard/verify/face": "/dashboard/verify",
  "/dashboard/verify/proofs": "/dashboard/verify",
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
          <Fragment key={crumb.href}>
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
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
