import type { LegacyRole } from "@/lib/api/types"

/**
 * `apps.accounts.serializers.UserSerializer`.
 *
 * `role` is the legacy fixed field (still required for order assignment); `roles`
 * lists the RBAC role codes the account currently holds. They can diverge — RBAC
 * is the authorization source, the legacy field drives production assignment.
 */
export interface Employee {
  id: string
  username: string
  full_name: string
  employee_code: string
  role: LegacyRole
  role_display: string
  roles: string[]
  email: string
  email_verified_at: string | null
  is_active: boolean
  date_joined: string
}

export interface EmployeeCreateInput {
  username: string
  password: string
  full_name: string
  employee_code: string
  role: LegacyRole
  email?: string
  is_active?: boolean
}

export interface EmployeeUpdateInput {
  full_name?: string
  employee_code?: string
  role?: LegacyRole
  email?: string
}

/** Deactivation adds the count of still-active assignments that need reassigning. */
export interface EmployeeDeactivationResult extends Employee {
  active_orders?: number
  detail?: string
}

export const LEGACY_ROLES: { value: LegacyRole; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "CUTTING_MAN", label: "Cutting Man" },
  { value: "OPERATOR", label: "Operator" },
]

/** Legacy role required to be assignable to each production department. */
export const REQUIRED_ROLE_FOR_DEPARTMENT = {
  CUTTING: "CUTTING_MAN",
  OPERATOR: "OPERATOR",
} as const
