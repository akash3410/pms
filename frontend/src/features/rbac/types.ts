import type { ScopeType } from "@/lib/api/types"

/** `PermissionRefSerializer` — embedded in roles, restrictions and catalogues. */
export interface PermissionRef {
  id: string
  key: string
  name: string
  module: string
  action: string
  supported_scopes: ScopeType[]
}

/** `PermissionSerializer` */
export interface Permission extends PermissionRef {
  description: string
  is_active: boolean
  is_system: boolean
  created_at: string
  updated_at: string
}

/** One permission grant on a role, with the scope it was granted at. */
export interface RolePermissionGrant {
  permission: PermissionRef
  scope: ScopeType
  options: Record<string, unknown>
}

/** `RoleSerializer` */
export interface Role {
  id: string
  code: string
  name: string
  description: string
  is_active: boolean
  is_system: boolean
  permissions: RolePermissionGrant[]
  created_at: string
  updated_at: string
}

export interface RoleRef {
  id: string
  code: string
  name: string
  is_active: boolean
  is_system: boolean
}

/** `UserRoleSerializer` — one assignment (revoked ones appear on request). */
export interface UserRoleAssignment {
  id: string
  role: RoleRef
  assigned_by_label: string
  created_at: string
  revoked_at: string | null
}

/** `DepartmentSerializer` */
export interface Department {
  id: string
  code: string
  name: string
  description: string
  is_production: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/** `DepartmentMembershipSerializer` */
export interface DepartmentMembership {
  id: string
  user_id: string
  user_label: string
  department: Department
  is_primary: boolean
  created_at: string
  ended_at: string | null
}

/** `UserScopeRestrictionSerializer` — restrict-only override for one user. */
export interface ScopeRestriction {
  id: string
  permission: PermissionRef
  permission_key: string
  scope: ScopeType
  options: Record<string, unknown>
  created_at: string
}

/** Input for `PUT /rbac/roles/{id}/permissions/` (full replacement). */
export interface RolePermissionInput {
  permission: string
  scope: ScopeType
  options?: Record<string, unknown>
}

export interface RoleInput {
  code?: string
  name: string
  description?: string
}

export interface PermissionInput {
  key?: string
  name: string
  description?: string
  supported_scopes?: ScopeType[]
}

export interface DepartmentInput {
  code?: string
  name: string
  description?: string
  is_production?: boolean
  is_active?: boolean
}

/** Effective access snapshot for any user (admin view of a user's access). */
export interface UserEffectiveAccess {
  user: string
  is_superuser: boolean
  permissions: Record<string, { scope: ScopeType; options: Record<string, unknown> }[]>
  restrictions: Record<string, { scope: ScopeType; options: Record<string, unknown> }>
}
