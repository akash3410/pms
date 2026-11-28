/**
 * Single source of environment configuration for the whole client.
 *
 * `VITE_API_BASE_URL` must point at the Django REST API, including the `/api/v1`
 * version prefix (e.g. `/api/v1` behind the dev proxy, or
 * `https://host/api/v1` when the backend is hosted separately).
 */
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(
  /\/+$/,
  "",
)

export const config = {
  /** API root, e.g. `/api/v1`. */
  apiBaseUrl,
  appName: import.meta.env.VITE_APP_NAME ?? "POMS",
  /** Base URL used to resolve relative media/API links returned by the backend. */
  apiOrigin: apiBaseUrl.startsWith("http") ? new URL(apiBaseUrl).origin : "",
  isDev: import.meta.env.DEV,
} as const
