/**
 * Response shapes shared across endpoint modules.
 *
 * The backend uses DRF's page-number pagination
 * (`common.pagination.StandardResultsSetPagination`) for list endpoints only;
 * report endpoints return plain arrays or objects and are typed individually.
 */
export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

/** Mirror of `common.enums` on the backend. */
export type DepartmentCode = "CUTTING" | "OPERATOR"
export type ProductionStatus = "PENDING" | "COMPLETED"
export type OverallStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED"
export type PeriodType = "DAILY" | "WEEKLY" | "MONTHLY"
export type NoteDepartment = "GENERAL" | DepartmentCode
export type LegacyRole = "ADMIN" | "CUTTING_MAN" | "OPERATOR"

/** Mirror of `apps.rbac.constants.SCOPE_TYPES`. */
export type ScopeType =
  | "ALL"
  | "ASSIGNED"
  | "CREATED_BY_ME"
  | "DEPARTMENT"
  | "OWN_PROFILE"

export const DEPARTMENTS: { value: DepartmentCode; label: string }[] = [
  { value: "CUTTING", label: "Cutting" },
  { value: "OPERATOR", label: "Operator" },
]

export const PRODUCTION_STATUSES: {
  value: ProductionStatus
  label: string
}[] = [
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
]

export const OVERALL_STATUSES: { value: OverallStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
]

export const PERIOD_TYPES: { value: PeriodType; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
]

export const SCOPE_TYPES: {
  value: ScopeType
  label: string
  description: string
}[] = [
  {
    value: "ALL",
    label: "All",
    description: "Every record in the module.",
  },
  {
    value: "ASSIGNED",
    label: "Assigned",
    description: "Records where the user is the current assignee.",
  },
  {
    value: "CREATED_BY_ME",
    label: "Created by me",
    description: "Records the user created.",
  },
  {
    value: "DEPARTMENT",
    label: "Department",
    description: "Records belonging to the user's active departments.",
  },
  {
    value: "OWN_PROFILE",
    label: "Own profile",
    description: "Only the user's own record.",
  },
]

export const NOTE_DEPARTMENTS: { value: NoteDepartment; label: string }[] = [
  { value: "GENERAL", label: "General" },
  { value: "CUTTING", label: "Cutting" },
  { value: "OPERATOR", label: "Operator" },
]

/** Compact user reference embedded in most payloads. */
export interface UserRef {
  id: string
  full_name: string
  employee_code: string
  role: LegacyRole
}
