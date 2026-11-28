import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auditApi } from "@/features/audit/api"
import { employeesApi } from "@/features/employees/api"
import type { Employee } from "@/features/employees/types"
import type { ScopeType } from "@/lib/api/types"

import {
  departmentsApi,
  permissionsApi,
  rolesApi,
  userAccessApi,
  type DepartmentListParams,
  type PermissionListParams,
  type RoleListParams,
} from "./api"
import type {
  DepartmentInput,
  PermissionInput,
  RoleInput,
  RolePermissionInput,
} from "./types"

export const rbacKeys = {
  roles: (params: RoleListParams) => ["rbac", "roles", params] as const,
  role: (id: string) => ["rbac", "role", id] as const,
  rolePermissions: (id: string) => ["rbac", "role", id, "permissions"] as const,
  roleHistory: (id: string) => ["rbac", "role", id, "history"] as const,
  permissions: (params: PermissionListParams) =>
    ["rbac", "permissions", params] as const,
  departments: (params: DepartmentListParams) =>
    ["rbac", "departments", params] as const,
  department: (id: string) => ["rbac", "department", id] as const,
  members: (id: string) => ["rbac", "department", id, "members"] as const,
  userRoles: (userId: string) => ["rbac", "user", userId, "roles"] as const,
  userRestrictions: (userId: string) =>
    ["rbac", "user", userId, "restrictions"] as const,
  userEffective: (userId: string) =>
    ["rbac", "user", userId, "effective"] as const,
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */
export function useRoles(params: RoleListParams) {
  return useQuery({
    queryKey: rbacKeys.roles(params),
    queryFn: () => rolesApi.list(params),
    placeholderData: (previous) => previous,
  })
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.role(id ?? ""),
    queryFn: () => rolesApi.get(id as string),
    enabled: Boolean(id),
  })
}

export function useRolePermissions(id: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.rolePermissions(id ?? ""),
    queryFn: () => rolesApi.permissions(id as string),
    enabled: Boolean(id),
  })
}

export function useRoleHistory(id: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.roleHistory(id ?? ""),
    queryFn: () => rolesApi.history(id as string),
    enabled: Boolean(id),
  })
}

function useInvalidateRbac() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["rbac"] })
    // Role changes alter effective access: refresh related caches too.
    void queryClient.invalidateQueries({ queryKey: ["audit"] })
  }
}

export function useCreateRole() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: RoleInput) => rolesApi.create(input),
    onSuccess: invalidate,
  })
}

export function useUpdateRole(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: Partial<RoleInput>) => rolesApi.update(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteRole() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: invalidate,
  })
}

export function useSetRoleActive() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? rolesApi.activate(id) : rolesApi.deactivate(id),
    onSuccess: invalidate,
  })
}

export function useSetRolePermissions(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (permissions: RolePermissionInput[]) =>
      rolesApi.setPermissions(id, permissions),
    onSuccess: invalidate,
  })
}

/* -------------------------------------------------------------------------- */
/* Permission catalogue                                                       */
/* -------------------------------------------------------------------------- */
export function usePermissions(params: PermissionListParams) {
  return useQuery({
    queryKey: rbacKeys.permissions(params),
    queryFn: () => permissionsApi.list(params),
    placeholderData: (previous) => previous,
  })
}

/** Full catalogue used by the role editor (module-grouped client-side). */
export function usePermissionCatalogue() {
  return useQuery({
    queryKey: rbacKeys.permissions({ page_size: 200 }),
    queryFn: () => permissionsApi.list({ page_size: 200, ordering: "module" }),
    select: (data) => data.results,
    staleTime: 60_000,
  })
}

export function useCreatePermission() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: PermissionInput) => permissionsApi.create(input),
    onSuccess: invalidate,
  })
}

export function useUpdatePermission() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PermissionInput> }) =>
      permissionsApi.update(id, input),
    onSuccess: invalidate,
  })
}

export function useSetPermissionActive() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? permissionsApi.activate(id) : permissionsApi.deactivate(id),
    onSuccess: invalidate,
  })
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */
export function useDepartments(params: DepartmentListParams) {
  return useQuery({
    queryKey: rbacKeys.departments(params),
    queryFn: () => departmentsApi.list(params),
    placeholderData: (previous) => previous,
  })
}

export function useDepartment(id: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.department(id ?? ""),
    queryFn: () => departmentsApi.get(id as string),
    enabled: Boolean(id),
  })
}

export function useDepartmentMembers(id: string | undefined, includeEnded = false) {
  return useQuery({
    queryKey: [...rbacKeys.members(id ?? ""), includeEnded],
    queryFn: () => departmentsApi.members(id as string, includeEnded),
    enabled: Boolean(id),
  })
}

export function useCreateDepartment() {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: DepartmentInput) => departmentsApi.create(input),
    onSuccess: invalidate,
  })
}

export function useUpdateDepartment(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: Partial<DepartmentInput>) =>
      departmentsApi.update(id, input),
    onSuccess: invalidate,
  })
}

export function useAddDepartmentMember(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: ({ userId, isPrimary }: { userId: string; isPrimary: boolean }) =>
      departmentsApi.addMember(id, userId, isPrimary),
    onSuccess: invalidate,
  })
}

export function useEndMembership(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (membershipId: string) =>
      departmentsApi.endMembership(id, membershipId),
    onSuccess: invalidate,
  })
}

export function useSetPrimaryMembership(id: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (membershipId: string) =>
      departmentsApi.setPrimary(id, membershipId),
    onSuccess: invalidate,
  })
}

/* -------------------------------------------------------------------------- */
/* User access                                                                */
/* -------------------------------------------------------------------------- */
export function useUserRoles(userId: string | undefined, includeRevoked = false) {
  return useQuery({
    queryKey: [...rbacKeys.userRoles(userId ?? ""), includeRevoked],
    queryFn: () => userAccessApi.roles(userId as string, includeRevoked),
    enabled: Boolean(userId),
  })
}

export function useUserRestrictions(userId: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.userRestrictions(userId ?? ""),
    queryFn: () => userAccessApi.restrictions(userId as string),
    enabled: Boolean(userId),
  })
}

export function useUserEffectiveAccess(userId: string | undefined) {
  return useQuery({
    queryKey: rbacKeys.userEffective(userId ?? ""),
    queryFn: () => userAccessApi.effectivePermissions(userId as string),
    enabled: Boolean(userId),
  })
}

export function useAssignRole(userId: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (roleId: string) => userAccessApi.assignRole(userId, roleId),
    onSuccess: invalidate,
  })
}

export function useRevokeRole(userId: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (assignmentId: string) =>
      userAccessApi.revokeRole(userId, assignmentId),
    onSuccess: invalidate,
  })
}

export function useSetRestriction(userId: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (input: {
      permission: string
      scope: ScopeType
      options?: Record<string, unknown>
    }) => userAccessApi.setRestriction(userId, input),
    onSuccess: invalidate,
  })
}

export function useRemoveRestriction(userId: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (permissionKey: string) =>
      userAccessApi.removeRestriction(userId, permissionKey),
    onSuccess: invalidate,
  })
}

export function useSetSuperuser(userId: string) {
  const invalidate = useInvalidateRbac()
  return useMutation({
    mutationFn: (enabled: boolean) => userAccessApi.setSuperuser(userId, enabled),
    onSuccess: invalidate,
  })
}

/** Employees for department-membership and role-assignment pickers. */
export function useEmployeeDirectory(enabled = true) {
  return useQuery({
    queryKey: ["employees", "directory"],
    queryFn: () => employeesApi.list({ page_size: 200, ordering: "employee_code" }),
    enabled,
    select: (data): Employee[] => data.results.filter((employee) => employee.is_active),
    staleTime: 60_000,
  })
}

/** Cheap audit fetch used by detail screens (role/permission history). */
export function useAuditTrail(params: Parameters<typeof auditApi.list>[0]) {
  return useQuery({
    queryKey: ["audit", "list", params],
    queryFn: () => auditApi.list(params),
    placeholderData: (previous) => previous,
  })
}
