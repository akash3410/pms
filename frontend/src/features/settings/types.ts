/** `GET/PATCH /system/settings/` */
export interface SystemSettings {
  invitation_expiry_hours: number
  require_email_verification: boolean
  max_invitation_expiry_hours: number
}

export interface SystemSettingsUpdate {
  invitation_expiry_hours?: number
  require_email_verification?: boolean
}

/**
 * `GET/PATCH /system/email/`.
 *
 * The backend accepts no SMTP secret here at all: `smtp_password` is rejected
 * with a validation error, because credentials live in the environment variable
 * named by `password_env_var`.
 */
export interface EmailConfiguration {
  host: string
  port: number
  username: string
  from_email: string
  use_tls: boolean
  use_ssl: boolean
  timeout: number
  is_active: boolean
  password_env_var: string
  has_password: boolean
}

export interface EmailConfigurationUpdate {
  host?: string
  port?: number
  username?: string
  from_email?: string
  use_tls?: boolean
  use_ssl?: boolean
  timeout?: number
  is_active?: boolean
  password_env_var?: string
}

export interface EmailTestResult {
  detail: string
  recipient?: string
  reason?: string
}
