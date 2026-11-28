import { get, patch, post, pruneParams } from "@/lib/api/client"
import type { Paginated } from "@/lib/api/types"

import type {
  AssignmentHistoryEntry,
  AssignInput,
  NoteCreateInput,
  Order,
  OrderCreateInput,
  OrderListParams,
  OrderNote,
  OrderUpdateInput,
  StatusHistoryEntry,
  StatusUpdateInput,
} from "./types"

/** Base path for one order, used by the detail queries and mutations. */
export const orderPath = (id: string) => `/orders/${id}/`

export const ordersApi = {
  /** GET /orders/ — results are scoped by `orders.view_order` for the caller. */
  list: (params: OrderListParams = {}) =>
    get<Paginated<Order>>("/orders/", pruneParams({ ...params })),

  /** GET /orders/{id}/ — 404 when the record is outside the caller's scope. */
  get: (id: string) => get<Order>(orderPath(id)),

  /**
   * POST /orders/ — multipart: the order number, the original card image and the
   * two assignees. Statuses and overall status are derived by the backend.
   */
  create: (input: OrderCreateInput) => {
    const form = new FormData()
    form.append("order_number", input.order_number)
    form.append("original_image", input.original_image)
    form.append("cutting_man", input.cutting_man)
    form.append("operator", input.operator)
    return post<Order>("/orders/", form)
  },

  /** PATCH /orders/{id}/ — metadata and/or a replacement original image. */
  update: (id: string, input: OrderUpdateInput) => {
    if (input.original_image) {
      const form = new FormData()
      if (input.order_number !== undefined) {
        form.append("order_number", input.order_number)
      }
      form.append("original_image", input.original_image)
      return patch<Order>(orderPath(id), form)
    }
    return patch<Order>(orderPath(id), {
      ...(input.order_number !== undefined
        ? { order_number: input.order_number }
        : {}),
    })
  },

  /** PATCH /orders/{id}/assign/ — appends immutable assignment history. */
  assign: (id: string, input: AssignInput) =>
    patch<Order>(`${orderPath(id)}assign/`, input),

  /** GET /orders/{id}/assignments/ — newest first. */
  assignments: (id: string, params?: { page?: number; page_size?: number }) =>
    get<Paginated<AssignmentHistoryEntry>>(
      `${orderPath(id)}assignments/`,
      pruneParams({ ...params }),
    ),

  /**
   * PATCH /orders/{id}/status/ — one department's status. A request equal to the
   * current status is an accepted no-op (no history row, no credit).
   */
  updateStatus: (id: string, input: StatusUpdateInput) =>
    patch<Order>(`${orderPath(id)}status/`, input),

  /** GET /orders/{id}/history/ — immutable status history, newest first. */
  history: (id: string, params?: { page?: number; page_size?: number }) =>
    get<Paginated<StatusHistoryEntry>>(
      `${orderPath(id)}history/`,
      pruneParams({ ...params }),
    ),

  /** GET /orders/{id}/notes/ */
  notes: (id: string, params?: { page?: number; page_size?: number }) =>
    get<Paginated<OrderNote>>(
      `${orderPath(id)}notes/`,
      pruneParams({ ...params }),
    ),

  /** POST /orders/{id}/notes/ */
  createNote: (id: string, input: NoteCreateInput) =>
    post<OrderNote>(`${orderPath(id)}notes/`, input),
}
