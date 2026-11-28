import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { emailConfigApi, systemSettingsApi } from "./api"
import type { EmailConfigurationUpdate, SystemSettingsUpdate } from "./types"

export const settingsKeys = {
  system: () => ["system", "settings"] as const,
  email: () => ["system", "email"] as const,
}

export function useSystemSettings(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.system(),
    queryFn: systemSettingsApi.get,
    enabled,
  })
}

export function useUpdateSystemSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SystemSettingsUpdate) => systemSettingsApi.update(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.system() })
      void queryClient.invalidateQueries({ queryKey: ["invitations", "settings"] })
    },
  })
}

export function useEmailConfiguration(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.email(),
    queryFn: emailConfigApi.get,
    enabled,
  })
}

export function useUpdateEmailConfiguration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EmailConfigurationUpdate) => emailConfigApi.update(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.email() })
    },
  })
}

export function useTestEmail() {
  return useMutation({
    mutationFn: (email?: string) => emailConfigApi.test(email),
  })
}
