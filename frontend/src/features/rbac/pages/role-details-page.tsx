import { ArrowLeft, Loader2, Lock, RefreshCw, Save, ShieldCheck } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { useAccess } from "@/app/access"
import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/misc"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  usePermissionCatalogue,
  useRole,
  useRoleHistory,
  useRolePermissions,
  useSetRoleActive,
  useSetRolePermissions,
  useUpdateRole,
} from "@/features/rbac/hooks"
import type { RolePermissionInput } from "@/features/rbac/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDateTime, humanize } from "@/lib/format"
import { SCOPE_TYPES, type ScopeType } from "@/lib/api/types"

const SCOPE_LABELS = new Map(SCOPE_TYPES.map((scope) => [scope.value, scope]))

function scopeLabel(scope: ScopeType) {
  return SCOPE_LABELS.get(scope)?.label ?? humanize(scope)
}

/**
 * Role permission editor.
 *
 * The API replaces the whole grant set on PUT, so the editor keeps a local draft
 * and submits the complete list. Only scopes declared as supported by a
 * permission are offered — the backend rejects anything else.
 */
function PermissionEditor({ roleId }: { roleId: string }) {
  const catalogue = usePermissionCatalogue()
  const current = useRolePermissions(roleId)
  const mutation = useSetRolePermissions(roleId)
  const [draft, setDraft] = React.useState<Record<string, ScopeType>>({})
  const [dirty, setDirty] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!current.data) return
    const next: Record<string, ScopeType> = {}
    for (const grant of current.data) {
      next[grant.permission.key] = grant.scope
    }
    setDraft(next)
    setDirty(false)
  }, [current.data])

  if (catalogue.isPending || current.isPending) {
    return <LoadingState label="Loading the permission catalogue…" />
  }
  if (catalogue.isError) {
    return <ErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />
  }
  if (current.isError) {
    return <ErrorState error={current.error} onRetry={() => void current.refetch()} />
  }

  const grouped = new Map<string, typeof catalogue.data>()
  for (const permission of catalogue.data) {
    const list = grouped.get(permission.module) ?? []
    list.push(permission)
    grouped.set(permission.module, list)
  }

  const toggle = (key: string, supported: readonly ScopeType[]) => {
    setDraft((previous) => {
      const next = { ...previous }
      if (key in next) delete next[key]
      else {
        // Prefer the broadest scope the permission supports.
        const preferred: ScopeType | undefined = supported.includes("ALL")
          ? "ALL"
          : supported[0]
        if (preferred) next[key] = preferred
      }
      return next
    })
    setDirty(true)
  }

  const setScope = (key: string, scope: ScopeType) => {
    setDraft((previous) => ({ ...previous, [key]: scope }))
    setDirty(true)
  }

  const save = async () => {
    setError(null)
    const permissions: RolePermissionInput[] = Object.entries(draft).map(
      ([permission, scope]) => ({ permission, scope }),
    )
    try {
      await mutation.mutateAsync(permissions)
      toast.success("Role permissions saved.")
      setDirty(false)
    } catch (caught) {
      setError(normalizeError(caught).detail)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {Object.keys(draft).length} of {catalogue.data.length} permissions granted.
          Scope decides <em>which records</em> a permission reaches.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => {
              const next: Record<string, ScopeType> = {}
              for (const grant of current.data ?? []) {
                next[grant.permission.key] = grant.scope
              }
              setDraft(next)
              setDirty(false)
              setError(null)
            }}
          >
            Reset
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="size-4" />
                Save permissions
              </>
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([module, permissions]) => (
          <section key={module} className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {humanize(module)}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {permissions.map((permission) => {
                const checked = permission.key in draft
                return (
                  <li
                    key={permission.key}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        id={`perm-${permission.key}`}
                        checked={checked}
                        disabled={!permission.is_active}
                        onCheckedChange={() =>
                          toggle(permission.key, permission.supported_scopes)
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <Label
                          htmlFor={`perm-${permission.key}`}
                          className="text-sm font-medium"
                        >
                          {permission.name}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          <code>{permission.key}</code>
                          {!permission.is_active ? " · inactive" : ""}
                        </p>
                      </div>
                    </div>

                    <div className="w-full sm:w-44">
                      <Select
                        value={draft[permission.key] ?? undefined}
                        onValueChange={(value) =>
                          setScope(permission.key, value as ScopeType)
                        }
                        disabled={!checked}
                      >
                        <SelectTrigger size="sm" aria-label={`Scope for ${permission.key}`}>
                          <SelectValue placeholder="Not granted" />
                        </SelectTrigger>
                        <SelectContent>
                          {permission.supported_scopes.map((scope) => (
                            <SelectItem key={scope} value={scope}>
                              {scopeLabel(scope)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {!dirty ? (
        <p className="text-xs text-muted-foreground">
          Active users are affected on their next request — permission changes are
          never cached in the token.
        </p>
      ) : (
        <p className="text-xs font-medium text-status-pending-foreground">
          Unsaved changes. Save to apply them.
        </p>
      )}
    </div>
  )
}

function RoleHistory({ roleId }: { roleId: string }) {
  const query = useRoleHistory(roleId)

  if (query.isPending) return <LoadingState label="Loading role history…" />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No audit events recorded for this role yet.
      </p>
    )

  return (
    <ul className="divide-y divide-border">
      {query.data.map((event) => (
        <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
          <div>
            <p className="text-sm font-medium">{humanize(event.action.replace(/\./g, " "))}</p>
            <p className="text-xs text-muted-foreground">
              {event.actor_label || "system"} · {event.target_type}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(event.created_at)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function RoleDetailsPage() {
  const { roleId } = useParams<{ roleId: string }>()
  const { can } = useAccess()
  const query = useRole(roleId)
  const setActive = useSetRoleActive()
  const updateRole = useUpdateRole(roleId ?? "")
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (query.data) {
      setName(query.data.name)
      setDescription(query.data.description)
    }
  }, [query.data])

  if (!roleId) return <ErrorState error={new Error("Missing role id")} title="Invalid role link" />
  if (query.isPending) return <LoadingState label="Loading role…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/roles">
            <ArrowLeft className="size-4" />
            Back to roles
          </Link>
        </Button>
        <ErrorState
          error={query.error}
          title="Could not load this role"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const role = query.data
  const canManage = can("roles.manage_roles")

  const saveDetails = async () => {
    setError(null)
    try {
      await updateRole.mutateAsync({ name, description })
      toast.success("Role updated.")
      setEditing(false)
    } catch (caught) {
      setError(normalizeError(caught).detail)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={role.name}
        description={role.description || "No description provided."}
        crumbs={[{ label: "Roles", to: "/admin/roles" }, { label: role.code }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/roles">
                <ArrowLeft className="size-4" />
                Roles
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={setActive.isPending}
                onClick={async () => {
                  try {
                    await setActive.mutateAsync({ id: role.id, active: !role.is_active })
                    toast.success(
                      `Role ${role.code} ${role.is_active ? "deactivated" : "activated"}.`,
                    )
                  } catch (caught) {
                    toast.error(normalizeError(caught).detail)
                  }
                }}
              >
                {role.is_active ? "Deactivate role" : "Activate role"}
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" onClick={() => setEditing((value) => !value)}>
                {editing ? "Cancel edit" : "Edit details"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{role.code}</code>
        <Badge variant={role.is_active ? "success" : "neutral"}>
          {role.is_active ? "Active" : "Inactive"}
        </Badge>
        {role.is_system ? (
          <Badge variant="info">
            <Lock aria-hidden="true" />
            System role
          </Badge>
        ) : null}
        <Badge variant="outline">{role.permissions.length} permissions</Badge>
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit role details</CardTitle>
            <CardDescription>
              The role code is permanent; only the display name and description change.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Name</Label>
                <input
                  id="role-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-description">Description</Label>
                <input
                  id="role-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
              </div>
            </div>
            <Button size="sm" onClick={() => void saveDetails()} disabled={updateRole.isPending}>
              {updateRole.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save details"
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-0 py-0">
        <Tabs defaultValue="permissions" className="gap-0">
          <div className="border-b border-border p-4">
            <TabsList>
              <TabsTrigger value="permissions">
                <ShieldCheck className="size-4" />
                Permissions
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="permissions" className="pt-0">
            {canManage ? (
              <PermissionEditor roleId={role.id} />
            ) : (
              <div className="p-4">
                <Alert>
                  <AlertDescription>
                    You need <code>roles.manage_roles</code> to change this role's
                    permissions.
                  </AlertDescription>
                </Alert>
                <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                  {role.permissions.map((grant) => (
                    <li
                      key={grant.permission.key}
                      className="flex items-center justify-between gap-2 p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">{grant.permission.name}</p>
                        <code className="text-xs text-muted-foreground">
                          {grant.permission.key}
                        </code>
                      </div>
                      <Badge variant="outline">{scopeLabel(grant.scope)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
          <TabsContent value="history" className="pt-0">
            <RoleHistory roleId={role.id} />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  )
}
