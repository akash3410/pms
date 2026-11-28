import { get, patch, post } from "@/lib/api/client"

import type {
  EmailConfiguration,
  EmailConfigurationUpdate,
  EmailTestResult,
  SystemSettings,
  SystemSettingsUpdate,
} from "./types"

export const systemSettingsApi = {
  get: () => get<SystemSettings>("/system/settings/"),
  update: (input: SystemSettingsUpdate) =>
    patch<SystemSettings>("/system/settings/", input),
}

export const emailConfigApi = {
  get: () => get<EmailConfiguration>("/system/email/"),
  update: (input: EmailConfigurationUpdate) =>
    patch<EmailConfiguration>("/system/email/", input),
  /** Sends a real message; a 502 means transport failed, not a permission issue. */
  test: (email?: string) =>
    post<EmailTestResult>("/system/email/test/", email ? { email } : {}),
}
