import type { Order } from "@/features/orders/types"
import type {
  OverallStatus,
  PeriodType,
  ProductionStatus,
  UserRef,
} from "@/lib/api/types"

/**
 * `GET /reports/dashboard/` — aggregate counts only, all derived from live data.
 * The maps are sparse: a status/role/department only appears when its count > 0.
 */
export interface DashboardReport {
  orders_total: number
  orders_by_status: Partial<Record<OverallStatus, number>>
  orders_completed_today: number
  active_employees: number
  employees_by_role: Record<string, number>
  employees_by_department: Record<string, number>
  targets_total: number
  completion_credits_total: number
  recent_orders: Order[]
}

/** `GET /reports/employees/` */
export interface EmployeePerformanceRow {
  employee: {
    id: string
    full_name: string
    employee_code: string
    role: string
    is_active: boolean
  }
  cutting_assigned: number
  operator_assigned: number
  completion_credits: number
}

/** `GET /reports/production/` */
export interface ProductionReport {
  total_orders: number
  cutting: Partial<Record<ProductionStatus, number>>
  operator: Partial<Record<ProductionStatus, number>>
  completed_orders: number
  completion_rate_percent: number
}

/** `GET /reports/targets/` */
export interface TargetAchievementRow {
  target_id: string
  employee: Pick<UserRef, "id" | "full_name" | "employee_code">
  department: string
  period_type: PeriodType
  start_date: string
  end_date: string
  target_count: number
  achieved: number
  achievement_percent: number
}

/**
 * Report endpoints use limit/offset paging (max limit 500), not DRF page numbers.
 */
export interface ReportWindow {
  limit?: number
  offset?: number
}
