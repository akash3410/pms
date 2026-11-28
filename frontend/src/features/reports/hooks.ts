import { useQuery } from "@tanstack/react-query"

import { reportsApi } from "./api"
import type { ReportWindow } from "./types"

export const reportKeys = {
  all: ["reports"] as const,
  dashboard: () => ["reports", "dashboard"] as const,
  employees: (window: ReportWindow) => ["reports", "employees", window] as const,
  production: () => ["reports", "production"] as const,
  targets: (window: ReportWindow) => ["reports", "targets", window] as const,
}

export function useDashboardReport() {
  return useQuery({
    queryKey: reportKeys.dashboard(),
    queryFn: reportsApi.dashboard,
    // The dashboard is a live operational snapshot.
    staleTime: 30_000,
  })
}

export function useEmployeePerformanceReport(window: ReportWindow) {
  return useQuery({
    queryKey: reportKeys.employees(window),
    queryFn: () => reportsApi.employees(window),
    placeholderData: (previous) => previous,
  })
}

export function useProductionReport() {
  return useQuery({
    queryKey: reportKeys.production(),
    queryFn: reportsApi.production,
  })
}

export function useTargetsReport(window: ReportWindow) {
  return useQuery({
    queryKey: reportKeys.targets(window),
    queryFn: () => reportsApi.targets(window),
    placeholderData: (previous) => previous,
  })
}
