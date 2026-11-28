export const INVITATION_STATUSES = [
  { value: "PENDING", label: "Pending" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
] as const

export type InvitationStatus = (typeof INVITATION_STATUSES)[number]["value"]

export interface InvitationRole {
  id: string
  code: string
  name: string
}

/** `InvitationSerializer` — a read-only record plus lifecycle actions. */
export interface Invitation {
  id: string
  email: string
  full_name: string
  employee_code: string
  user: string | null
  roles: InvitationRole[]
  status: InvitationStatus
  expires_at: string
  accepted_at: string | null
  cancelled_at: string | null
  last_sent_at: string | null
  send_count: number
  created_by_label: string
  created_at: string
}

export interface InvitationCreateInput {
  email: string
  full_name?: string
  employee_code?: string
  roles?: string[]
}

export interface InvitationListParams {
  page?: number
  page_size?: number
  search?: string
  status?: InvitationStatus
  ordering?: string
}

/** `GET/PATCH /invitations/settings/` */
export interface InvitationSettings {
  invitation_expiry_hours: number
  max_invitation_expiry_hours: number
}
