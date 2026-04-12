import { headers } from "next/headers";

import { StandaloneLayout } from "@/components/standalone-layout";

export default async function ConsentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");

  return <StandaloneLayout cookies={cookies}>{children}</StandaloneLayout>;
}
