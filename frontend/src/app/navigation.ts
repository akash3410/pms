/**
 * Navigation model.
 *
 * Every entry declares the permission key(s) the backend enforces for that
 * screen, so the sidebar is generated from the user's *effective* access rather
 * than from a hardcoded role list. Backend permission keys are the exact strings
 * from `apps.rbac.constants.PERMISSION_CATALOGUE`.
 */
import {
  Building2,
  ClipboardList,
  FileBarChart2,
  HardHat,
  LayoutDashboard,
  ListChecks,
  Mail,
  ScrollText,
  Settings2,
  ShieldCheck,
  Target,
  Users,
  Workflow,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Visible when the user holds any of these permissions. */
  permissions: string[]
  /** Hide from the sidebar (route still exists) e.g. detail pages. */
  hidden?: boolean
  end?: boolean
}

export interface NavSection {
  id: string
  label: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        label: "Dashboard",
        to: "/",
        icon: LayoutDashboard,
        permissions: ["reports.view_reports"],
        end: true,
      },
      {
        label: "Orders",
        to: "/orders",
        icon: ClipboardList,
        permissions: ["orders.view_order"],
      },
      {
        label: "My work",
        to: "/production",
        icon: Workflow,
        permissions: ["production.update_status"],
      },
      {
        label: "Employees",
        to: "/employees",
        icon: Users,
        permissions: ["employees.view_employee"],
      },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    items: [
      {
        label: "Targets",
        to: "/targets",
        icon: Target,
        permissions: ["targets.view_targets"],
      },
      {
        label: "Reports",
        to: "/reports",
        icon: FileBarChart2,
        permissions: ["reports.view_reports"],
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        label: "Roles",
        to: "/admin/roles",
        icon: ShieldCheck,
        permissions: ["roles.view_roles"],
      },
      {
        label: "Permissions",
        to: "/admin/permissions",
        icon: ListChecks,
        permissions: ["permissions.view_permissions"],
      },
      {
        label: "Departments",
        to: "/admin/departments",
        icon: Building2,
        permissions: ["departments.view_departments"],
      },
      {
        label: "Invitations",
        to: "/admin/invitations",
        icon: Mail,
        permissions: ["invitations.view_invitation"],
      },
      {
        label: "Audit log",
        to: "/admin/audit",
        icon: ScrollText,
        permissions: ["audit_logs.view_logs"],
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        label: "Settings",
        to: "/system/settings",
        icon: Settings2,
        permissions: ["system.manage_settings"],
      },
      {
        label: "Email",
        to: "/system/email",
        icon: HardHat,
        permissions: ["system.manage_email_config"],
      },
    ],
  },
]

/** Flattened list used by breadcrumbs and the permission-denied hint. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
)

/** Longest matching route wins so `/orders/new` resolves to "Orders". */
export function findNavItemByPath(pathname: string): NavItem | null {
  const matches = ALL_NAV_ITEMS.filter(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  )
  if (matches.length === 0) return null
  return matches.reduce((best, item) =>
    item.to.length > best.to.length ? item : best,
  )
}
