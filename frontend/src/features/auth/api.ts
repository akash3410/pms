import { get, patch, post } from "@/lib/api/client"

import type {
  AuthUser,
  ChangePasswordInput,
  EffectivePermissions,
  LoginResponse,
  ProfileUpdateInput,
} from "./types"

export const authApi = {
  /** POST /auth/login/ — accepts an email address (or username). */
  login: (identifier: string, password: string) =>
    post<LoginResponse>("/auth/login/", {
      email: identifier,
      password,
    }),

  logout: (refresh: string) =>
    post<void>("/auth/logout/", { refresh }),

  me: () => get<AuthUser>("/auth/me/"),

  updateProfile: (input: ProfileUpdateInput) =>
    patch<AuthUser>("/auth/me/", input),

  changePassword: (input: ChangePasswordInput) =>
    post<{ detail: string }>("/auth/change-password/", input),

  forgotPassword: (email: string) =>
    post<void>("/auth/password/forgot/", { email }),

  resetPassword: (token: string, newPassword: string) =>
    post<{ detail: string }>("/auth/password/reset/", {
      token,
      new_password: newPassword,
    }),

  verifyEmail: (token: string) =>
    post<{ detail: string }>("/auth/email/verify/", { token }),

  /** Public: activate an invited account by setting its password. */
  acceptInvitation: (token: string, password: string) =>
    post<{ detail: string; user: string }>("/invitations/accept/", {
      token,
      password,
    }),

  resendVerification: () =>
    post<{ detail: string }>("/auth/email/resend-verification/"),

  /** Effective RBAC access for one user (self-service for own profile). */
  effectivePermissions: (userId: string) =>
    get<EffectivePermissions>(`/rbac/users/${userId}/effective-permissions/`),
}
