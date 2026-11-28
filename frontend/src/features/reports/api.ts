import { get, pruneParams } from "@/lib/api/client"

import type {
  DashboardReport,
  EmployeePerformanceRow,
  ProductionReport,
  ReportWindow,
  TargetAchievementRow,
} from "./types"

/**
 * All reporting endpoints require `reports.view_reports` and return plain JSON
 * (no pagination envelope). Collections are windowed with `limit`/`offset`.
 */
export const reportsApi = {
  dashboard: () => get<DashboardReport>("/reports/dashboard/"),

  employees: (window: ReportWindow = {}) =>
    get<EmployeePerformanceRow[]>(
      "/reports/employees/",
      pruneParams({ limit: window.limit, offset: window.offset }),
    ),

  production: () => get<ProductionReport>("/reports/production/"),

  targets: (window: ReportWindow = {}) =>
    get<TargetAchievementRow[]>(
      "/reports/targets/",
      pruneParams({ limit: window.limit, offset: window.offset }),
    ),
}
