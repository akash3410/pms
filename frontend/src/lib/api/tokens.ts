/**
 * Token storage.
 *
 * The backend issues stateless JWTs and has no httpOnly-cookie session option,
 * so tokens live in `localStorage`. That is the only pattern the API supports;
 * the XSS exposure it implies is documented in `docs/API_INTEGRATION_NOTES.md`.
 *
 * The access token is additionally cached in memory to avoid a synchronous
 * storage read on every request.
 */
const ACCESS_KEY = "poms.access"
const REFRESH_KEY = "poms.refresh"

let accessTokenCache: string | null = null
let refreshTokenCache: string | null = null
let loaded = false

function load(): void {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    accessTokenCache = window.localStorage.getItem(ACCESS_KEY)
    refreshTokenCache = window.localStorage.getItem(REFRESH_KEY)
  } catch {
    // Storage can be unavailable (private mode / disabled cookies).
    accessTokenCache = null
    refreshTokenCache = null
  }
}

export const tokenStore = {
  get access(): string | null {
    load()
    return accessTokenCache
  },

  get refresh(): string | null {
    load()
    return refreshTokenCache
  },

  set(tokens: { access?: string | null; refresh?: string | null }): void {
    load()
    if (tokens.access !== undefined) {
      accessTokenCache = tokens.access
      persist(ACCESS_KEY, tokens.access)
    }
    if (tokens.refresh !== undefined) {
      refreshTokenCache = tokens.refresh
      persist(REFRESH_KEY, tokens.refresh)
    }
  },

  clear(): void {
    accessTokenCache = null
    refreshTokenCache = null
    persist(ACCESS_KEY, null)
    persist(REFRESH_KEY, null)
  },

  hasSession(): boolean {
    load()
    return Boolean(refreshTokenCache || accessTokenCache)
  },
}

function persist(key: string, value: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures — the in-memory copy still works for this tab.
  }
}
