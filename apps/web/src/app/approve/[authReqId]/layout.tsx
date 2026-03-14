import { headers } from "next/headers";

import { StandaloneLayout } from "@/components/layouts/standalone-layout";

export default async function ApproveLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");

  return <StandaloneLayout cookies={cookies}>{children}</StandaloneLayout>;
}
