import * as React from "react"
import { Navigate, useLocation } from "react-router-dom"

import { PermissionDeniedState } from "@/components/feedback/states"
import { LoadingState } from "@/components/feedback/states"
import { useSession } from "@/features/auth/session"
import { useAccess } from "@/app/access"

/** Full-page loader while the stored session is validated. */
export function SessionLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadingState label="Restoring your session…" />
    </div>
  )
}

/** Sends anonymous visitors to /login, preserving the attempted location. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const location = useLocation()

  if (status === "loading") return <SessionLoadingScreen />
  if (status === "anonymous") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }
  return <>{children}</>
}

/** Blocks a route when the user's effective permissions do not include it. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string[]
  children: React.ReactNode
}) {
  const { canAny, accessDenied } = useAccess()

  if (accessDenied) {
    return (
      <PermissionDeniedState description="Your access could not be resolved from the server. Contact an administrator if this persists." />
    )
  }
  if (!canAny(...permission)) {
    return (
      <PermissionDeniedState description="Your account does not hold the permission required for this screen. The backend will also reject the underlying requests." />
    )
  }
  return <>{children}</>
}

/** Redirects to the first screen the user actually has access to. */
export function HomeRedirect({ children }: { children: React.ReactNode }) {
  const { canAny } = useAccess()
  const hasAnyDestination =
    canAny("reports.view_reports") ||
    canAny("orders.view_order") ||
    canAny("production.update_status") ||
    canAny("employees.view_employee") ||
    canAny("targets.view_targets")

  if (!hasAnyDestination) {
    return (
      <PermissionDeniedState description="Your account currently has no operational permissions. Ask an administrator to assign a role." />
    )
  }
  return <>{children}</>
}