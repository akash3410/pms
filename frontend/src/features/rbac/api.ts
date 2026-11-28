import { del, get, patch, post, pruneParams, put } from "@/lib/api/client"
import type { Paginated, ScopeType } from "@/lib/api/types"

import type { AuditLog } from "@/features/audit/types"

import type {
  Department,
  DepartmentInput,
  DepartmentMembership,
  Permission,
  PermissionInput,
  Role,
  RoleInput,
  RolePermissionGrant,
  RolePermissionInput,
  ScopeRestriction,
  UserEffectiveAccess,
  UserRoleAssignment,
} from "./types"

export interface RoleListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  is_active?: boolean
  is_system?: boolean
}

export const rolesApi = {
  list: (params: RoleListParams = {}) =>
    get<Paginated<Role>>("/rbac/roles/", pruneParams({ ...params })),
  get: (id: string) => get<Role>(`/rbac/roles/${id}/`),
  create: (input: RoleInput) => post<Role>("/rbac/roles/", input),
  update: (id: string, input: Partial<RoleInput>) =>
    patch<Role>(`/rbac/roles/${id}/`, input),
  remove: (id: string) => del<void>(`/rbac/roles/${id}/`),
  activate: (id: string) => post<Role>(`/rbac/roles/${id}/activate/`),
  deactivate: (id: string) => post<Role>(`/rbac/roles/${id}/deactivate/`),

  /** GET returns the current grant list; PUT replaces it entirely. */
  permissions: (id: string) =>
    get<RolePermissionGrant[]>(`/rbac/roles/${id}/permissions/`),
  setPermissions: (id: string, permissions: RolePermissionInput[]) =>
    put<RolePermissionGrant[]>(`/rbac/roles/${id}/permissions/`, { permissions }),

  /** Audit events for this role (max 200, newest first). */
  history: (id: string) => get<AuditLog[]>(`/rbac/roles/${id}/history/`),
}

export interface PermissionListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  module?: string
  is_active?: boolean
  is_system?: boolean
}

export const permissionsApi = {
  list: (params: PermissionListParams = {}) =>
    get<Paginated<Permission>>("/rbac/permissions/", pruneParams({ ...params })),
  get: (id: string) => get<Permission>(`/rbac/permissions/${id}/`),
  create: (input: PermissionInput) => post<Permission>("/rbac/permissions/", input),
  update: (id: string, input: Partial<PermissionInput>) =>
    patch<Permission>(`/rbac/permissions/${id}/`, input),
  remove: (id: string) => del<void>(`/rbac/permissions/${id}/`),
  activate: (id: string) => post<Permission>(`/rbac/permissions/${id}/activate/`),
  deactivate: (id: string) =>
    post<Permission>(`/rbac/permissions/${id}/deactivate/`),
}

export interface DepartmentListParams {
  page?: number
  page_size?: number
  search?: string
  is_active?: boolean
  is_production?: boolean
}

export const departmentsApi = {
  list: (params: DepartmentListParams = {}) =>
    get<Paginated<Department>>("/rbac/departments/", pruneParams({ ...params })),
  get: (id: string) => get<Department>(`/rbac/departments/${id}/`),
  create: (input: DepartmentInput) => post<Department>("/rbac/departments/", input),
  update: (id: string, input: Partial<DepartmentInput>) =>
    patch<Department>(`/rbac/departments/${id}/`, input),
  remove: (id: string) => del<void>(`/rbac/departments/${id}/`),

  /** Members are returned as a plain array (no pagination). */
  members: (id: string, includeEnded = false) =>
    get<DepartmentMembership[]>(
      `/rbac/departments/${id}/members/`,
      pruneParams({ include_ended: includeEnded ? "true" : undefined }),
    ),
  addMember: (id: string, userId: string, isPrimary = false) =>
    post<DepartmentMembership>(`/rbac/departments/${id}/members/`, {
      user: userId,
      is_primary: isPrimary,
    }),
  endMembership: (id: string, membershipId: string) =>
    del<void>(`/rbac/departments/${id}/members/${membershipId}/`),
  setPrimary: (id: string, membershipId: string) =>
    post<DepartmentMembership>(
      `/rbac/departments/${id}/members/${membershipId}/primary/`,
    ),
}

export const userAccessApi = {
  roles: (userId: string, includeRevoked = false) =>
    get<UserRoleAssignment[]>(
      `/rbac/users/${userId}/roles/`,
      pruneParams({ include_revoked: includeRevoked ? "true" : undefined }),
    ),
  assignRole: (userId: string, roleId: string) =>
    post<UserRoleAssignment>(`/rbac/users/${userId}/roles/`, { role: roleId }),
  revokeRole: (userId: string, assignmentId: string) =>
    del<void>(`/rbac/users/${userId}/roles/${assignmentId}/`),

  effectivePermissions: (userId: string) =>
    get<UserEffectiveAccess>(
      `/rbac/users/${userId}/effective-permissions/`,
    ),

  restrictions: (userId: string) =>
    get<ScopeRestriction[]>(`/rbac/users/${userId}/scope-restrictions/`),
  setRestriction: (
    userId: string,
    input: { permission: string; scope: ScopeType; options?: Record<string, unknown> },
  ) => put<ScopeRestriction>(`/rbac/users/${userId}/scope-restrictions/`, input),
  removeRestriction: (userId: string, permissionKey: string) =>
    del<void>(`/rbac/users/${userId}/scope-restrictions/`, {
      data: { permission: permissionKey },
    }),

  setSuperuser: (userId: string, enabled: boolean) =>
    post<{ user: string; is_superuser: boolean }>(
      `/rbac/users/${userId}/superuser/`,
      { enabled },
    ),
}
