"use client";

import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { TRPCProvider, trpc } from "@/lib/trpc/client";

interface TrpcProviderProps {
  children: ReactNode;
}

export function TrpcProvider({ children }: Readonly<TrpcProviderProps>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpc}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
