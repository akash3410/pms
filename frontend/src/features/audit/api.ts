import { get, pruneParams } from "@/lib/api/client"
import type { Paginated } from "@/lib/api/types"

import type { AuditListParams, AuditLog } from "./types"

/** Read-only: the backend exposes no write route for the audit trail. */
export const auditApi = {
  list: (params: AuditListParams = {}) =>
    get<Paginated<AuditLog>>("/audit-logs/", pruneParams({ ...params })),
  get: (id: number) => get<AuditLog>(`/audit-logs/${id}/`),
}
