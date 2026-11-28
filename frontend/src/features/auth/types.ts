import type { ScopeType } from "@/lib/api/types"

/** `apps.accounts.serializers.UserSerializer` / `ProfileSerializer`. */
export interface AuthUser {
  id: string
  username: string
  full_name: string
  employee_code: string
  /** Legacy fixed role, retained by the backend for compatibility. */
  role: string
  role_display: string
  /** Codes of the RBAC roles currently assigned (active assignments only). */
  roles: string[]
  email: string
  email_verified_at: string | null
  is_active: boolean
  date_joined: string
}

export interface LoginResponse {
  access: string
  refresh: string
  user: AuthUser
}

export interface ScopeGrant {
  scope: ScopeType
  options: Record<string, unknown>
}

/**
 * `GET /rbac/users/{id}/effective-permissions/`
 *
 * Permissions are resolved from the database on every request — they are never
 * read from the token — so this snapshot is refreshed rather than trusted
 * indefinitely.
 */
export interface EffectivePermissions {
  user: string
  is_superuser: boolean
  superuser: boolean
  /** permission key → granted scopes (union across active roles). */
  permissions: Record<string, ScopeGrant[]>
  /** permission key → restrict-only override. */
  restrictions: Record<string, ScopeGrant>
}

export interface ProfileUpdateInput {
  full_name?: string
  email?: string
}

export interface ChangePasswordInput {
  current_password: string
  new_password: string
}
