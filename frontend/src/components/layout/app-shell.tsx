import * as React from "react"
import { Outlet, useLocation } from "react-router-dom"

import { findNavItemByPath } from "@/app/navigation"
import type { Crumb } from "@/components/layout/page-header"
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"

/** Extra breadcrumb context a page can push into the shell. */
interface ShellContextValue {
  setTrail: (trail: Crumb[]) => void
}

const ShellContext = React.createContext<ShellContextValue | null>(null)

export function useShellTrail(trail: Crumb[]) {
  const context = React.useContext(ShellContext)
  const key = JSON.stringify(trail)
  React.useEffect(() => {
    context?.setTrail(JSON.parse(key) as Crumb[])
  }, [context, key])
}

export function AppShell() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [trail, setTrail] = React.useState<Crumb[]>([])

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const sectionItem = findNavItemByPath(location.pathname)
  const baseCrumbs: Crumb[] = sectionItem
    ? [
        { label: "Home", to: "/" },
        ...(sectionItem.to === "/" ? [] : [{ label: sectionItem.label, to: sectionItem.to }]),
      ]
    : [{ label: "Home", to: "/" }]

  const crumbs = React.useMemo(() => {
    if (trail.length === 0) return baseCrumbs
    // Page-provided trail wins, but keep the section crumb as its root.
    return [{ label: "Home", to: "/" }, ...trail]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, location.pathname, sectionItem?.label])

  const contextValue = React.useMemo<ShellContextValue>(
    () => ({ setTrail }),
    [],
  )

  return (
    <ShellContext.Provider value={contextValue}>
      <div className="flex h-full min-h-screen bg-background">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar crumbs={crumbs} onMenuClick={() => setMobileOpen(true)} />
          <main
            id="main-content"
            className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  )
}
