/**
 * `apps.audit.serializers.AuditLogSerializer`.
 *
 * Audit rows are append-only: the API exposes list/retrieve only, so the UI has
 * no edit or delete affordances anywhere.
 */
export interface AuditLog {
  id: number
  actor_id: string | null
  actor_label: string
  action: string
  target_type: string
  target_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  request_id: string | null
  created_at: string
}

export interface AuditListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  action?: string
  target_type?: string
  actor?: string
}
