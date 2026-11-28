import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { employeesApi } from "@/features/employees/api"
import type { Employee } from "@/features/employees/types"

import { targetsApi } from "./api"
import type { TargetInput, TargetListParams } from "./types"

export const targetKeys = {
  all: ["targets"] as const,
  list: (params: TargetListParams) => ["targets", "list", params] as const,
  detail: (id: string) => ["targets", "detail", id] as const,
  assignable: ["targets", "assignable-employees"] as const,
}

export function useTargets(params: TargetListParams) {
  return useQuery({
    queryKey: targetKeys.list(params),
    queryFn: () => targetsApi.list(params),
    placeholderData: (previous) => previous,
  })
}

export function useTarget(id: string | undefined) {
  return useQuery({
    queryKey: targetKeys.detail(id ?? ""),
    queryFn: () => targetsApi.get(id as string),
    enabled: Boolean(id),
  })
}

/** Employees who can hold a production target (active, production role). */
export function useTargetEmployees() {
  return useQuery({
    queryKey: targetKeys.assignable,
    queryFn: () => employeesApi.list({ page_size: 200, ordering: "employee_code" }),
    select: (data): Employee[] =>
      data.results.filter(
        (employee) =>
          employee.is_active &&
          (employee.role === "CUTTING_MAN" || employee.role === "OPERATOR"),
      ),
    staleTime: 60_000,
  })
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  void queryClient.invalidateQueries({ queryKey: targetKeys.all })
  if (id) void queryClient.invalidateQueries({ queryKey: targetKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: ["reports"] })
}

export function useCreateTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TargetInput) => targetsApi.create(input),
    onSuccess: () => invalidate(queryClient),
  })
}

export function useUpdateTarget(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<TargetInput>) => targetsApi.update(id, input),
    onSuccess: () => invalidate(queryClient, id),
  })
}
