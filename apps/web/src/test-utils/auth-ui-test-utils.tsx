import type { ReactElement } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";

import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";

/**
 * Renders a component inside Zentity's Better Auth UI provider with a fresh
 * query cache. The calling test file mocks `@/lib/auth/auth-client` and
 * `next/navigation`, since the provider reads both.
 */
export function renderWithAuthUI(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BetterAuthUIProvider socialProviders={[]}>{ui}</BetterAuthUIProvider>
    </QueryClientProvider>
  );
}
