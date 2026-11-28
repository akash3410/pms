import {
  KeyRound,
  LogOut,
  Mail,
  Menu,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Breadcrumbs, type Crumb } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/misc"
import { authApi } from "@/features/auth/api"
import { useSession } from "@/features/auth/session"
import { errorMessage } from "@/lib/api/errors"

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function Topbar({
  crumbs,
  onMenuClick,
}: {
  crumbs: Crumb[]
  onMenuClick: () => void
}) {
  const { user, logout, refreshAccess, refreshUser } = useSession()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [sendingVerification, setSendingVerification] = React.useState(false)

  const handleLogout = async () => {
    setSigningOut(true)
    try {
      await logout()
      navigate("/login", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const handleRefreshAccess = async () => {
    setRefreshing(true)
    try {
      await Promise.all([refreshAccess(), refreshUser()])
      toast.success("Access refreshed from the server.")
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRefreshing(false)
    }
  }

  const handleResendVerification = async () => {
    setSendingVerification(true)
    try {
      const response = await authApi.resendVerification()
      toast.success(response.detail)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSendingVerification(false)
    }
  }

  const emailUnverified = Boolean(user && !user.email_verified_at)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <Breadcrumbs items={crumbs} />
      </div>

      {emailUnverified ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-status-pending-foreground sm:inline-flex"
              onClick={handleResendVerification}
              disabled={sendingVerification}
            >
              <Mail className="size-4" />
              <span className="hidden md:inline">Verify email</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Your email address is not verified yet. Click to resend the
            verification email.
          </TooltipContent>
        </Tooltip>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              <AvatarFallback>
                {initials(user?.full_name ?? user?.username ?? "")}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="max-w-36 truncate text-xs font-semibold leading-tight">
                {user?.full_name ?? "—"}
              </p>
              <p className="max-w-36 truncate text-[11px] leading-tight text-muted-foreground">
                {user?.employee_code ?? ""}
              </p>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="space-y-0.5">
            <p className="text-sm font-semibold">{user?.full_name}</p>
            <p className="text-xs font-normal text-muted-foreground">
              {user?.email || user?.username}
            </p>
            {user?.roles && user.roles.length > 0 ? (
              <p className="flex items-center gap-1 pt-1 text-[11px] font-normal text-muted-foreground">
                <ShieldCheck className="size-3" />
                {user.roles.join(", ")}
              </p>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profile">
              <UserRound />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/change-password">
              <KeyRound />
              Change password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void handleRefreshAccess()}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            Refresh access
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={signingOut}
            onSelect={() => void handleLogout()}
          >
            <LogOut />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
