import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { Toaster } from "sonner"

import { TooltipProvider } from "@/components/ui/misc"
import { SessionProvider } from "@/features/auth/session"
import { normalizeError } from "@/lib/api/errors"

/**
 * Server-state defaults.
 *
 * Authorization data is never cached by TanStack Query — it lives in the
 * session provider and is refetched explicitly — so a revoked permission takes
 * effect on the next request rather than after a stale cache window.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          const apiError = normalizeError(error)
          // Never retry auth/permission/validation failures.
          if (
            apiError.isUnauthorized ||
            apiError.isForbidden ||
            apiError.status === 400 ||
            apiError.status === 404 ||
            apiError.status === 409
          ) {
            return false
          }
          return failureCount < 2
        },
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  // One client per app instance (not per render).
  const [queryClient] = React.useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster
            position="top-center"
            richColors
            closeButton
            toastOptions={{ classNames: { toast: "text-sm" } }}
          />
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}
