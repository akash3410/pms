import { get, patch, post, pruneParams } from "@/lib/api/client"
import type { Paginated } from "@/lib/api/types"

import type {
  Employee,
  EmployeeCreateInput,
  EmployeeDeactivationResult,
  EmployeeUpdateInput,
} from "./types"

export interface EmployeeListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
}

export const employeesApi = {
  list: (params: EmployeeListParams = {}) =>
    get<Paginated<Employee>>("/employees/", pruneParams({ ...params })),

  get: (id: string) => get<Employee>(`/employees/${id}/`),

  create: (input: EmployeeCreateInput) => post<Employee>("/employees/", input),

  /** PATCH only — the backend deliberately does not allow PUT or DELETE. */
  update: (id: string, input: EmployeeUpdateInput) =>
    patch<Employee>(`/employees/${id}/`, input),

  /** Soft deactivation; roles and department memberships are revoked server-side. */
  deactivate: (id: string) =>
    post<EmployeeDeactivationResult>(`/employees/${id}/deactivate/`),

  /** Reactivation never restores previously held roles — by design. */
  reactivate: (id: string) => post<Employee>(`/employees/${id}/reactivate/`),
}
