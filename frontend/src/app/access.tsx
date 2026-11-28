/**
 * Permission helpers for rendering.
 *
 * These only decide what to *show*. The backend remains the authorization
 * authority and returns 403 for anything not permitted, which every screen
 * handles explicitly.
 */
import * as React from "react"

import { useSession } from "@/features/auth/session"
import type { ScopeType } from "@/lib/api/types"

export function useAccess() {
  const { can, canAny, hasScope, isSuperuser, access, accessDenied } =
    useSession()
  return { can, canAny, hasScope, isSuperuser, access, accessDenied }
}

interface CanProps {
  /** One permission key, or several (any-of). */
  permission: string | string[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

/** Renders children only when the user holds the required permission(s). */
export function Can({ permission, children, fallback = null }: CanProps) {
  const { can, canAny } = useAccess()
  const allowed = Array.isArray(permission)
    ? canAny(...permission)
    : can(permission)
  return <>{allowed ? children : fallback}</>
}

/** Renders children only when the user holds a specific scope for a permission. */
export function CanScope({
  permission,
  scope,
  children,
  fallback = null,
}: {
  permission: string
  scope: ScopeType
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { hasScope } = useAccess()
  return <>{hasScope(permission, scope) ? children : fallback}</>
}
