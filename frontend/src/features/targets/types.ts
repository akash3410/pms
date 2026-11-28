import type {
  DepartmentCode,
  PeriodType,
  UserRef,
} from "@/lib/api/types"

/**
 * `apps.targets.serializers.EmployeeTargetSerializer`.
 *
 * `achieved_count` is the number of completion credits currently attributed to
 * the target — computed by the backend, never by the client.
 */
export interface EmployeeTarget {
  id: string
  employee: UserRef
  department: DepartmentCode
  period_type: PeriodType
  start_date: string
  end_date: string
  target_count: number
  created_by: UserRef | null
  created_at: string
  achieved_count: number
}

/** `EmployeeTargetWriteSerializer` — employee, department, period, range, count. */
export interface TargetInput {
  employee: string
  department: DepartmentCode
  period_type: PeriodType
  start_date: string
  end_date: string
  target_count: number
}

export interface TargetListParams {
  page?: number
  page_size?: number
  ordering?: string
  employee?: string
  department?: DepartmentCode
  period_type?: PeriodType
}
