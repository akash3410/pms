/**
 * Session + authorization state.
 *
 * Authorization data comes exclusively from the backend. The token carries no
 * permission claims; `GET /rbac/users/{id}/effective-permissions/` is the single
 * source of truth and is refreshed whenever roles or scopes may have changed.
 *
 * Hiding navigation or buttons based on these checks is a usability affordance —
 * never a security boundary. The backend re-checks every request and answers 403
 * when access is missing, which the UI renders as a permission-denied state.
 */
import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { normalizeError } from "@/lib/api/errors"
import { tokenStore } from "@/lib/api/tokens"
import { setSessionExpiredHandler } from "@/lib/api/client"
import type { ScopeType } from "@/lib/api/types"

import { authApi } from "./api"
import type { AuthUser, EffectivePermissions } from "./types"

const USER_CACHE_KEY = "poms.user"

type SessionStatus = "loading" | "authenticated" | "anonymous"

interface SessionContextValue {
  status: SessionStatus
  user: AuthUser | null
  access: EffectivePermissions | null
  /** True when effective permissions could not be resolved (e.g. 403). */
  accessDenied: boolean
  isSuperuser: boolean
  can: (permission: string) => boolean
  canAny: (...permissions: string[]) => boolean
  hasScope: (permission: string, scope: ScopeType) => boolean
  login: (identifier: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refreshAccess: () => Promise<void>
  refreshUser: () => Promise<void>
  updateUser: (user: AuthUser) => void
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

function readCachedUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(USER_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      return parsed as AuthUser
    }
    return null
  } catch {
    return null
  }
}

function writeCachedUser(user: AuthUser | null): void {
  try {
    if (user === null) window.localStorage.removeItem(USER_CACHE_KEY)
    else window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user))
  } catch {
    // Non-fatal: the session still works for this tab.
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<SessionStatus>(() =>
    tokenStore.hasSession() ? "loading" : "anonymous",
  )
  const [user, setUser] = React.useState<AuthUser | null>(() =>
    tokenStore.hasSession() ? readCachedUser() : null,
  )
  const [access, setAccess] = React.useState<EffectivePermissions | null>(null)
  const [accessDenied, setAccessDenied] = React.useState(false)

  const clearSession = React.useCallback(() => {
    tokenStore.clear()
    writeCachedUser(null)
    setUser(null)
    setAccess(null)
    setAccessDenied(false)
    setStatus("anonymous")
    queryClient.clear()
  }, [queryClient])

  // A failed token refresh means the session is gone: drop all local state.
  React.useEffect(() => {
    setSessionExpiredHandler(clearSession)
    return () => setSessionExpiredHandler(() => undefined)
  }, [clearSession])

  const loadAccess = React.useCallback(
    async (userId: string) => {
      try {
        const snapshot = await authApi.effectivePermissions(userId)
        setAccess(snapshot)
        setAccessDenied(false)
      } catch (error) {
        const apiError = normalizeError(error)
        if (apiError.isUnauthorized) throw apiError
        // 403: the account cannot even resolve its own permissions. Keep the
        // session but treat every gated feature as unavailable.
        setAccess(null)
        setAccessDenied(apiError.isForbidden)
      }
    },
    [],
  )

  const refreshAccess = React.useCallback(async () => {
    const id = user?.id
    if (!id) return
    await loadAccess(id)
  }, [user?.id, loadAccess])

  const refreshUser = React.useCallback(async () => {
    try {
      const fresh = await authApi.me()
      setUser(fresh)
      writeCachedUser(fresh)
    } catch (error) {
      const apiError = normalizeError(error)
      if (apiError.isUnauthorized) {
        clearSession()
        return
      }
      // A 403 here only means the profile endpoint is not permitted; the
      // identity we already hold from login remains valid.
    }
  }, [clearSession])

  /** Bootstrap: validate the stored session and resolve current access. */
  React.useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (!tokenStore.hasSession()) {
        if (!cancelled) setStatus("anonymous")
        return
      }
      try {
        const cached = readCachedUser()
        if (cached) {
          if (cancelled) return
          setUser(cached)
          setStatus("authenticated")
          await Promise.all([
            loadAccess(cached.id).catch(() => undefined),
            refreshUser(),
          ])
          return
        }
        // No cached identity: the profile is the only way to learn our id.
        const me = await authApi.me()
        if (cancelled) return
        setUser(me)
        writeCachedUser(me)
        setStatus("authenticated")
        await loadAccess(me.id).catch(() => undefined)
      } catch {
        if (!cancelled) clearSession()
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
    // Runs once per mount: later changes are handled by the mutations below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = React.useCallback(
    async (identifier: string, password: string) => {
      // Clear any stale state before establishing a new session.
      tokenStore.clear()
      setAccess(null)
      setAccessDenied(false)
      const response = await authApi.login(identifier, password)
      tokenStore.set({ access: response.access, refresh: response.refresh })
      setUser(response.user)
      writeCachedUser(response.user)
      setStatus("authenticated")
      queryClient.clear()
      await loadAccess(response.user.id).catch(() => undefined)
      return response.user
    },
    [loadAccess, queryClient],
  )

  const logout = React.useCallback(async () => {
    const refresh = tokenStore.refresh
    if (refresh) {
      // Best effort: even if blacklisting fails the local session is dropped.
      await authApi.logout(refresh).catch(() => undefined)
    }
    clearSession()
  }, [clearSession])

  const updateUser = React.useCallback((next: AuthUser) => {
    setUser(next)
    writeCachedUser(next)
  }, [])

  const permissionKeys = React.useMemo(() => {
    if (!access) return [] as string[]
    return Object.keys(access.permissions ?? {})
  }, [access])

  const isSuperuser = Boolean(access?.superuser || access?.is_superuser)

  const can = React.useCallback(
    (permission: string) => {
      if (isSuperuser) return true
      if (!access) return false
      return Object.prototype.hasOwnProperty.call(
        access.permissions ?? {},
        permission,
      )
    },
    [access, isSuperuser],
  )

  const canAny = React.useCallback(
    (...permissions: string[]) => permissions.some((key) => can(key)),
    [can],
  )

  const hasScope = React.useCallback(
    (permission: string, scope: ScopeType) => {
      if (isSuperuser) return true
      const grants = access?.permissions?.[permission]
      if (!grants) return false
      return grants.some((grant) => grant.scope === scope)
    },
    [access, isSuperuser],
  )

  const value = React.useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      access,
      accessDenied,
      isSuperuser,
      can,
      canAny,
      hasScope,
      login,
      logout,
      refreshAccess,
      refreshUser,
      updateUser,
    }),
    [
      status,
      user,
      access,
      accessDenied,
      isSuperuser,
      can,
      canAny,
      hasScope,
      login,
      logout,
      refreshAccess,
      refreshUser,
      updateUser,
    ],
  )

  // `permissionKeys` is derived for debugging/telemetry consumers.
  void permissionKeys

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>")
  }
  return context
}
