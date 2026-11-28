/**
 * Central HTTP client.
 *
 * Responsibilities:
 *  - attach the bearer access token to every request;
 *  - refresh an expired access token exactly once per expiry and replay the
 *    queued requests (no request storms, no duplicate refreshes);
 *  - normalise every failure into `ApiError`;
 *  - download authenticated binary media (order images are not public URLs).
 *
 * Never log tokens or credentials.
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios"

import { config } from "@/lib/config"

import { ApiError, normalizeError } from "./errors"
import { tokenStore } from "./tokens"

const baseConfig: AxiosRequestConfig = {
  baseURL: config.apiBaseUrl,
  timeout: 30_000,
  headers: { Accept: "application/json" },
}

export const http: AxiosInstance = axios.create(baseConfig)

/** Requests that must never trigger a refresh attempt. */
const AUTH_FREE_PATHS = [
  "/auth/login/",
  "/auth/refresh/",
  "/auth/password/forgot/",
  "/auth/password/reset/",
  "/invitations/accept/",
]

let refreshPromise: Promise<string> | null = null
/** Replaced by the session layer so the client stays free of router imports. */
let onSessionExpired: (() => void) | null = null

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler
}

http.interceptors.request.use((request: InternalAxiosRequestConfig) => {
  const token = tokenStore.access
  if (token) {
    request.headers.set("Authorization", `Bearer ${token}`)
  }
  return request
})

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as
      | (InternalAxiosRequestConfig & { _pomsRetry?: boolean })
      | undefined
    const status = error.response?.status
    const url = request?.url ?? ""
    const isAuthFree = AUTH_FREE_PATHS.some((path) => url.includes(path))

    if (status === 401 && request && !request._pomsRetry && !isAuthFree) {
      request._pomsRetry = true
      const refreshToken = tokenStore.refresh
      if (!refreshToken) {
        expireSession()
        throw normalizeError(error)
      }
      try {
        const newAccess = await refreshAccessToken(refreshToken)
        request.headers.set("Authorization", `Bearer ${newAccess}`)
        return http.request(request)
      } catch {
        expireSession()
        throw new ApiError({
          message: "Your session has expired. Please sign in again.",
          status: 401,
        })
      }
    }

    throw normalizeError(error)
  },
)

async function refreshAccessToken(refreshToken: string): Promise<string> {
  // Collapse concurrent refreshes into one network call.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // Uses a bare axios call: the shared instance would recurse on 401.
      const response = await axios.post<{
        access: string
        refresh?: string
      }>(
        `${config.apiBaseUrl}/auth/refresh/`,
        { refresh: refreshToken },
        { headers: { "Content-Type": "application/json" }, timeout: 30_000 },
      )
      const { access, refresh } = response.data
      tokenStore.set({ access, refresh: refresh ?? refreshToken })
      return access
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function expireSession(): void {
  tokenStore.clear()
  onSessionExpired?.()
}

/** Small typed helpers so endpoint modules stay declarative. */
export async function get<T>(
  url: string,
  params?: Record<string, unknown>,
  configOverride?: AxiosRequestConfig,
): Promise<T> {
  const response = await http.get<T>(url, {
    params: pruneParams(params),
    ...configOverride,
  })
  return response.data
}

export async function post<T>(
  url: string,
  body?: unknown,
  configOverride?: AxiosRequestConfig,
): Promise<T> {
  const response = await http.post<T>(url, body, configOverride)
  return response.data
}

export async function patch<T>(
  url: string,
  body?: unknown,
  configOverride?: AxiosRequestConfig,
): Promise<T> {
  const response = await http.patch<T>(url, body, configOverride)
  return response.data
}

export async function put<T>(
  url: string,
  body?: unknown,
  configOverride?: AxiosRequestConfig,
): Promise<T> {
  const response = await http.put<T>(url, body, configOverride)
  return response.data
}

export async function del<T = void>(
  url: string,
  configOverride?: AxiosRequestConfig,
): Promise<T> {
  const response = await http.delete<T>(url, configOverride)
  return response.data
}

/**
 * Fetch an authenticated binary resource as an object URL.
 *
 * Order images are served by permission-checked endpoints, not public media
 * paths, so `<img src>` cannot be used directly. Callers must revoke the URL.
 */
export async function getObjectUrl(url: string): Promise<string> {
  // Serializers return either an absolute URL or a versioned path such as
  // `/api/v1/orders/{id}/original-image/`. Absolute paths already contain the
  // base prefix, so the shared `baseURL` must not be prepended again.
  const target = /^https?:\/\//i.test(url)
    ? { url }
    : url.startsWith("/")
      ? { url, baseURL: "" }
      : { url }

  const response = await http.get<Blob>(target.url, {
    ...target,
    responseType: "blob",
  })
  return URL.createObjectURL(response.data)
}

/** Drop empty values so the API does not receive `?status=` filters. */
export function pruneParams(
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!params) return undefined
  const entries = Object.entries(params).filter(([, value]) => {
    if (value === undefined || value === null || value === "") return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  })
  return Object.fromEntries(entries)
}

/** Build a query object for list endpoints (page, filters, search, ordering). */
export interface ListParams {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  [key: string]: unknown
}
