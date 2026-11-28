import { ChevronsLeft, ChevronsRight, X } from "lucide-react"
import * as React from "react"
import { NavLink } from "react-router-dom"

import { NAV_SECTIONS } from "@/app/navigation"
import { Button } from "@/components/ui/button"
import { useSession } from "@/features/auth/session"
import { cn } from "@/lib/utils"

const COLLAPSE_KEY = "poms.sidebar.collapsed"

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "true"
  } catch {
    return false
  }
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { canAny } = useSession()

  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin">
      {NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter(
          (item) => !item.hidden && canAny(...item.permissions),
        )
        if (visibleItems.length === 0) return null

        return (
          <div key={section.id} className="space-y-1">
            {!collapsed ? (
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {section.label}
              </p>
            ) : (
              <div className="mx-2 mb-2 h-px bg-border" aria-hidden="true" />
            )}
            <ul className="space-y-0.5">
              {visibleItems.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                          "focus-visible:outline-2 focus-visible:outline-offset-2",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          collapsed && "justify-center px-2",
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className={cn("truncate", collapsed && "sr-only")}>
                        {item.label}
                      </span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean
  onMobileClose: () => void
}) {
  const [collapsed, setCollapsed] = React.useState(readCollapsed)

  React.useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, String(collapsed))
    } catch {
      // Preference persistence is optional.
    }
  }, [collapsed])

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-2",
          )}
        >
          <BrandMark collapsed={collapsed} />
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start text-muted-foreground", collapsed && "justify-center")}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <>
                <ChevronsLeft className="size-4" />
                <span>Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <BrandMark collapsed={false} />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onMobileClose}
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav collapsed={false} onNavigate={onMobileClose} />
          </div>
        </div>
      ) : null}
    </>
  )
}

export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        P
      </div>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">POMS</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            Production Orders
          </p>
        </div>
      ) : null}
    </div>
  )
}
