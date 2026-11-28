import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { employeesApi } from "@/features/employees/api"
import type { Employee } from "@/features/employees/types"
import type { DepartmentCode } from "@/lib/api/types"

import { ordersApi } from "./api"
import type {
  AssignInput,
  NoteCreateInput,
  Order,
  OrderCreateInput,
  OrderListParams,
  StatusUpdateInput,
} from "./types"

export const orderKeys = {
  all: ["orders"] as const,
  list: (params: OrderListParams) => ["orders", "list", params] as const,
  detail: (id: string) => ["orders", "detail", id] as const,
  assignments: (id: string, page: number) =>
    ["orders", "detail", id, "assignments", page] as const,
  history: (id: string, page: number) =>
    ["orders", "detail", id, "history", page] as const,
  notes: (id: string, page: number) =>
    ["orders", "detail", id, "notes", page] as const,
}

export function useOrders(params: OrderListParams) {
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: () => ordersApi.list(params),
    // Keep the previous page visible while the next one loads (no flashing).
    placeholderData: (previous) => previous,
  })
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ""),
    queryFn: () => ordersApi.get(id as string),
    enabled: Boolean(id),
  })
}

export function useOrderAssignments(id: string, page: number, enabled = true) {
  return useQuery({
    queryKey: orderKeys.assignments(id, page),
    queryFn: () => ordersApi.assignments(id, { page, page_size: 10 }),
    enabled,
    placeholderData: (previous) => previous,
  })
}

export function useOrderHistory(id: string, page: number, enabled = true) {
  return useQuery({
    queryKey: orderKeys.history(id, page),
    queryFn: () => ordersApi.history(id, { page, page_size: 10 }),
    enabled,
    placeholderData: (previous) => previous,
  })
}

export function useOrderNotes(id: string, page: number, enabled = true) {
  return useQuery({
    queryKey: orderKeys.notes(id, page),
    queryFn: () => ordersApi.notes(id, { page, page_size: 10 }),
    enabled,
    placeholderData: (previous) => previous,
  })
}

/** Invalidate every derived view of one order (and the dashboard/report caches). */
function invalidateOrder(
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["orders"] })
  if (id) void queryClient.invalidateQueries({ queryKey: orderKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: ["reports"] })
  void queryClient.invalidateQueries({ queryKey: ["targets"] })
}

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OrderCreateInput) => ordersApi.create(input),
    onSuccess: () => invalidateOrder(queryClient),
  })
}

export function useUpdateOrder(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { order_number?: string; original_image?: File }) =>
      ordersApi.update(id, input),
    onSuccess: () => invalidateOrder(queryClient, id),
  })
}

export function useAssignOrder(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AssignInput) => ordersApi.assign(id, input),
    onSuccess: () => invalidateOrder(queryClient, id),
  })
}

export function useUpdateOrderStatus(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StatusUpdateInput) => ordersApi.updateStatus(id, input),
    onSuccess: (order: Order) => {
      queryClient.setQueryData(orderKeys.detail(id), order)
      void queryClient.invalidateQueries({ queryKey: ["orders"] })
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
      void queryClient.invalidateQueries({ queryKey: ["targets"] })
    },
  })
}

export function useCreateOrderNote(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NoteCreateInput) => ordersApi.createNote(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders", "detail", id] })
    },
  })
}

/**
 * Employees eligible for a department assignment.
 *
 * Assignment validation lives in the backend (`resolve_assignee`): the employee
 * must hold the matching legacy role and be active. The UI mirrors that filter so
 * invalid choices are not offered, but the backend remains the authority.
 */
export function useAssigneeOptions(department: DepartmentCode, enabled = true) {
  const requiredRole = department === "CUTTING" ? "CUTTING_MAN" : "OPERATOR"
  return useQuery({
    queryKey: ["employees", "assignable", department],
    queryFn: () => employeesApi.list({ page_size: 200, ordering: "employee_code" }),
    enabled,
    select: (data): Employee[] =>
      data.results.filter(
        (employee) => employee.is_active && employee.role === requiredRole,
      ),
  })
}
