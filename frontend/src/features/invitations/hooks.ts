import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { invitationsApi } from "./api"
import type { InvitationCreateInput, InvitationListParams } from "./types"

export const invitationKeys = {
  list: (params: InvitationListParams) => ["invitations", "list", params] as const,
  settings: () => ["invitations", "settings"] as const,
}

export function useInvitations(params: InvitationListParams) {
  return useQuery({
    queryKey: invitationKeys.list(params),
    queryFn: () => invitationsApi.list(params),
    placeholderData: (previous) => previous,
  })
}

export function useInvitationSettings(enabled = true) {
  return useQuery({
    queryKey: invitationKeys.settings(),
    queryFn: invitationsApi.getSettings,
    enabled,
  })
}

export function useCreateInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvitationCreateInput) => invitationsApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] })
      void queryClient.invalidateQueries({ queryKey: ["audit"] })
    },
  })
}

export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invitationsApi.resend(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] })
    },
  })
}

export function useCancelInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invitationsApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] })
    },
  })
}

export function useUpdateInvitationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (hours: number) => invitationsApi.updateSettings(hours),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations", "settings"] })
      void queryClient.invalidateQueries({ queryKey: ["system", "settings"] })
    },
  })
}
