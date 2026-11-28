import type {
  DepartmentCode,
  NoteDepartment,
  OverallStatus,
  ProductionStatus,
  UserRef,
} from "@/lib/api/types"

/** `apps.orders.serializers.OrderSerializer`. */
export interface Order {
  id: string
  order_number: string
  /** Permission-checked API path, not a public media URL. */
  original_image: string | null
  generated_image: string | null
  cutting_man: UserRef | null
  operator: UserRef | null
  cutting_status: ProductionStatus
  operator_status: ProductionStatus
  overall_status: OverallStatus
  created_by: UserRef | null
  created_at: string
  updated_at: string
}

export interface OrderListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  overall_status?: OverallStatus
  cutting_status?: ProductionStatus
  operator_status?: ProductionStatus
}

/** `apps.orders.serializers.AssignmentHistorySerializer`. */
export interface AssignmentHistoryEntry {
  id: number
  department: DepartmentCode
  previous_employee: UserRef | null
  new_employee: UserRef
  assigned_by: UserRef | null
  assigned_at: string
}

/** `apps.production.serializers.ProductionStatusHistorySerializer`. */
export interface StatusHistoryEntry {
  id: number
  employee: UserRef
  department: DepartmentCode
  previous_status: ProductionStatus
  new_status: ProductionStatus
  note: string
  created_at: string
}

/** `apps.production.serializers.OrderNoteSerializer`. */
export interface OrderNote {
  id: string
  author: UserRef
  department: NoteDepartment
  body: string
  created_at: string
}

export interface OrderCreateInput {
  order_number: string
  original_image: File
  cutting_man: string
  operator: string
}

export interface OrderUpdateInput {
  order_number?: string
  original_image?: File
}

export interface AssignInput {
  department: DepartmentCode
  employee_id: string
}

export interface StatusUpdateInput {
  status: ProductionStatus
  /**
   * Only used when the actor holds `production.update_status` at scope ALL
   * (administrators). For employees the backend derives it from the assignment.
   */
  department?: DepartmentCode
  note?: string
}

export interface NoteCreateInput {
  department: NoteDepartment
  body: string
}
