import { get, patch, post, pruneParams } from "@/lib/api/client"
import type { Paginated } from "@/lib/api/types"

import type { EmployeeTarget, TargetInput, TargetListParams } from "./types"

/**
 * Targets support list/retrieve/create/partial_update only — the backend does
 * not expose DELETE, so the UI offers no delete action.
 */
export const targetsApi = {
  list: (params: TargetListParams = {}) =>
    get<Paginated<EmployeeTarget>>("/targets/", pruneParams({ ...params })),

  get: (id: string) => get<EmployeeTarget>(`/targets/${id}/`),

  create: (input: TargetInput) => post<EmployeeTarget>("/targets/", input),

  update: (id: string, input: Partial<TargetInput>) =>
    patch<EmployeeTarget>(`/targets/${id}/`, input),
}
