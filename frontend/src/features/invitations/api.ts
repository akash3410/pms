import { get, patch, post, pruneParams } from "@/lib/api/client"
import type { Paginated } from "@/lib/api/types"

import type {
  Invitation,
  InvitationCreateInput,
  InvitationListParams,
  InvitationSettings,
} from "./types"

export const invitationsApi = {
  list: (params: InvitationListParams = {}) =>
    get<Paginated<Invitation>>("/invitations/", pruneParams({ ...params })),
  get: (id: string) => get<Invitation>(`/invitations/${id}/`),
  create: (input: InvitationCreateInput) =>
    post<Invitation>("/invitations/", input),
  resend: (id: string) => post<Invitation>(`/invitations/${id}/resend/`),
  cancel: (id: string) => post<Invitation>(`/invitations/${id}/cancel/`),

  getSettings: () => get<InvitationSettings>("/invitations/settings/"),
  updateSettings: (invitationExpiryHours: number) =>
    patch<InvitationSettings>("/invitations/settings/", {
      invitation_expiry_hours: invitationExpiryHours,
    }),
}
