import { ArrowLeft, Loader2, Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAccess } from "@/app/access"
import { EmptyState, ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Alert, AlertDescription, Checkbox, Separator } from "@/components/ui/misc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { employeesApi } from "@/features/employees/api"
import {
  useAssignRole,
  usePermissionCatalogue,
  useRemoveRestriction,
  useRevokeRole,
  useRoles,
  useSetRestriction,
  useSetSuperuser,
  useUserEffectiveAccess,
  useUserRestrictions,
  useUserRoles,
} from "@/features/rbac/hooks"
import type { ScopeRestriction, UserRoleAssignment } from "@/features/rbac/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDateTime, humanize } from "@/lib/format"
import type { ScopeType } from "@/lib/api/types"

function RoleAssignments({ userId }: { userId: string }) {
  const [includeRevoked, setIncludeRevoked] = React.useState(false)
  const assignments = useUserRoles(userId, includeRevoked)
  const roles = useRoles({ page_size: 200, is_active: true, ordering: "name" })
  const assign = useAssignRole(userId)
  const revoke = useRevokeRole(userId)
  const [roleId, setRoleId] = React.useState("")
  const [revoking, setRevoking] = React.useState<UserRoleAssignment | null>(null)

  const assignedRoleIds = new Set(
    (assignments.data ?? [])
      .filter((assignment) => assignment.revoked_at === null)
      .map((assignment) => assignment.role.id),
  )
  const available = (roles.data?.results ?? []).filter(
    (role) => !assignedRoleIds.has(role.id),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Role assignments</CardTitle>
        <CardDescription>
          A user's effective permissions are the union of all active role grants,
          limited by personal scope restrictions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={roleId} onValueChange={setRoleId} disabled={roles.isPending}>
            <SelectTrigger aria-label="Role to assign">
              <SelectValue
                placeholder={
                  roles.isPending
                    ? "Loading roles…"
                    : available.length === 0
                      ? "No more roles available"
                      : "Select a role to assign"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name} · {role.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!roleId || assign.isPending}
            onClick={async () => {
              try {
                await assign.mutateAsync(roleId)
                toast.success("Role assigned.")
                setRoleId("")
              } catch (error) {
                toast.error(normalizeError(error).detail)
              }
            }}
          >
            {assign.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Assigning…
              </>
            ) : (
              <>
                <Plus className="size-4" />
                Assign role
              </>
            )}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="include-revoked"
            checked={includeRevoked}
            onCheckedChange={(checked) => setIncludeRevoked(checked === true)}
          />
          <Label htmlFor="include-revoked" className="text-xs">
            Include revoked assignments (history)
          </Label>
        </div>

        {assignments.isPending ? (
          <LoadingState label="Loading assignments…" />
        ) : assignments.isError ? (
          <ErrorState
            error={assignments.error}
            onRetry={() => void assignments.refetch()}
          />
        ) : (assignments.data ?? []).length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No roles assigned"
            description="This account can authenticate but has no permissions until a role is assigned."
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(assignments.data ?? []).map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {assignment.role.name}{" "}
                    <code className="text-xs text-muted-foreground">
                      {assignment.role.code}
                    </code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Assigned {formatDateTime(assignment.created_at)}
                    {assignment.assigned_by_label
                      ? ` by ${assignment.assigned_by_label}`
                      : ""}
                    {assignment.revoked_at
                      ? ` · revoked ${formatDateTime(assignment.revoked_at)}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {assignment.revoked_at ? (
                    <Badge variant="neutral">Revoked</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevoking(assignment)}
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setRevoking(null)}
          title={`Revoke ${revoking.role.name}?`}
          destructive
          confirmLabel="Revoke role"
          pending={revoke.isPending}
          description={
            <p>
              The user immediately loses every permission granted only through this
              role. The assignment row is retained as history.
            </p>
          }
          onConfirm={async () => {
            try {
              await revoke.mutateAsync(revoking.id)
              toast.success("Role revoked.")
              setRevoking(null)
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}
    </Card>
  )
}

function ScopeRestrictions({ userId }: { userId: string }) {
  const restrictions = useUserRestrictions(userId)
  const catalogue = usePermissionCatalogue()
  const setRestriction = useSetRestriction(userId)
  const removeRestriction = useRemoveRestriction(userId)
  const [permissionKey, setPermissionKey] = React.useState("")
  const [scope, setScope] = React.useState<ScopeType | "">("")
  const [removing, setRemoving] = React.useState<ScopeRestriction | null>(null)

  const selectedPermission = (catalogue.data ?? []).find(
    (permission) => permission.key === permissionKey,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scope restrictions</CardTitle>
        <CardDescription>
          A restriction can only narrow access, never widen it. The effective scope
          is the most restrictive of the role grant and this override.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={permissionKey}
              onValueChange={(value) => {
                setPermissionKey(value)
                setScope("")
              }}
              disabled={catalogue.isPending}
            >
              <SelectTrigger aria-label="Permission to restrict">
                <SelectValue placeholder="Select a permission" />
              </SelectTrigger>
              <SelectContent>
                {(catalogue.data ?? []).map((permission) => (
                  <SelectItem key={permission.key} value={permission.key}>
                    {permission.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={scope || undefined}
              onValueChange={(value) => setScope(value as ScopeType)}
              disabled={!selectedPermission}
            >
              <SelectTrigger aria-label="Restricted scope">
                <SelectValue placeholder="Select a scope" />
              </SelectTrigger>
              <SelectContent>
                {(selectedPermission?.supported_scopes ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {humanize(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!permissionKey || !scope || setRestriction.isPending}
            onClick={async () => {
              try {
                await setRestriction.mutateAsync({
                  permission: permissionKey,
                  scope: scope as ScopeType,
                })
                toast.success("Scope restriction saved.")
                setPermissionKey("")
                setScope("")
              } catch (error) {
                toast.error(normalizeError(error).detail)
              }
            }}
          >
            {setRestriction.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save restriction"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Only scopes the permission declares as supported can be chosen.
          </p>
        </div>

        {restrictions.isPending ? (
          <LoadingState label="Loading restrictions…" />
        ) : restrictions.isError ? (
          <ErrorState
            error={restrictions.error}
            onRetry={() => void restrictions.refetch()}
          />
        ) : (restrictions.data ?? []).length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No personal restrictions"
            description="This user is limited only by the scopes of their roles."
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(restrictions.data ?? []).map((restriction) => (
              <li
                key={restriction.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div>
                  <code className="text-sm">{restriction.permission_key}</code>
                  <p className="text-xs text-muted-foreground">
                    Restricted to {humanize(restriction.scope)} ·{" "}
                    {formatDateTime(restriction.created_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving(restriction)}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setRemoving(null)}
          title="Remove this restriction?"
          destructive
          confirmLabel="Remove"
          pending={removeRestriction.isPending}
          description={
            <p>
              Removing it restores whatever scope the user's roles grant for{" "}
              <code>{removing.permission_key}</code>. It never grants additional
              access beyond the role scope.
            </p>
          }
          onConfirm={async () => {
            try {
              await removeRestriction.mutateAsync(removing.permission_key)
              toast.success("Restriction removed.")
              setRemoving(null)
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}
    </Card>
  )
}

export function UserAccessPage() {
  const { userId } = useParams<{ userId: string }>()
  const { isSuperuser, can } = useAccess()
  const employee = useQuery({
    queryKey: ["employees", "detail", userId],
    queryFn: () => employeesApi.get(userId as string),
    enabled: Boolean(userId),
  })
  const effective = useUserEffectiveAccess(userId)
  const setSuperuser = useSetSuperuser(userId ?? "")
  const [confirmSuperuser, setConfirmSuperuser] = React.useState(false)

  if (!userId) return <ErrorState error={new Error("Missing user id")} title="Invalid user link" />
  if (employee.isPending) return <LoadingState label="Loading user…" />
  if (employee.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/employees">
            <ArrowLeft className="size-4" />
            Back to employees
          </Link>
        </Button>
        <ErrorState
          error={employee.error}
          title="Could not load this user"
          onRetry={() => void employee.refetch()}
        />
      </div>
    )
  }

  const person = employee.data
  const canManageUsers = can("users.manage_users")
  const canManageScopes = can("scopes.manage_user_restrictions")
  const canManageSuperusers = can("system.manage_superusers") || isSuperuser
  const isTargetSuperuser = Boolean(effective.data?.is_superuser)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Access for this user"
        description={`${person.full_name} · ${person.employee_code}`}
        crumbs={[
          { label: "Employees", to: "/employees" },
          { label: person.employee_code, to: `/employees/${person.id}` },
          { label: "Access" },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/employees/${person.id}`}>
              <ArrowLeft className="size-4" />
              Employee profile
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={person.is_active ? "success" : "neutral"}>
          {person.is_active ? "Active" : "Inactive"}
        </Badge>
        {person.roles.map((role) => (
          <Badge key={role} variant="outline">
            {role}
          </Badge>
        ))}
        {isTargetSuperuser ? (
          <Badge variant="destructive">
            <ShieldAlert aria-hidden="true" />
            Superuser
          </Badge>
        ) : null}
      </div>

      {isTargetSuperuser ? (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription>
            Superuser privileges bypass the permission catalogue entirely. This
            account can perform every action the backend exposes.
          </AlertDescription>
        </Alert>
      ) : null}

      {canManageUsers ? (
        <RoleAssignments userId={person.id} />
      ) : (
        <Alert>
          <AlertDescription>
            Role assignment requires <code>users.manage_users</code>.
          </AlertDescription>
        </Alert>
      )}

      {canManageScopes ? (
        <ScopeRestrictions userId={person.id} />
      ) : (
        <Alert>
          <AlertDescription>
            Scope restrictions require <code>scopes.manage_user_restrictions</code>.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Effective access</CardTitle>
          <CardDescription>
            The snapshot the backend resolves for this user right now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {effective.isPending ? (
            <LoadingState label="Resolving effective permissions…" />
          ) : effective.isError ? (
            <ErrorState error={effective.error} onRetry={() => void effective.refetch()} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {Object.keys(effective.data.permissions).length} permissions ·{" "}
                {Object.keys(effective.data.restrictions).length} personal restrictions
              </p>
              <Separator className="my-3" />
              <ul className="grid gap-2 sm:grid-cols-2">
                {Object.entries(effective.data.permissions)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, grants]) => (
                    <li key={key} className="rounded-md border border-border p-2">
                      <code className="text-xs">{key}</code>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {grants.map((grant, index) => (
                          <Badge key={`${key}-${index}`} variant="outline">
                            {humanize(grant.scope)}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {canManageSuperusers ? (
        <Card>
          <CardHeader>
            <CardTitle>Superuser privileges</CardTitle>
            <CardDescription>
              Granting superuser bypasses RBAC. The backend refuses to remove the last
              active superuser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant={isTargetSuperuser ? "destructive" : "outline"}
              size="sm"
              disabled={setSuperuser.isPending}
              onClick={() => setConfirmSuperuser(true)}
            >
              {isTargetSuperuser ? "Revoke superuser" : "Grant superuser"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {confirmSuperuser ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirmSuperuser(false)}
          title={isTargetSuperuser ? "Revoke superuser?" : "Grant superuser?"}
          destructive={isTargetSuperuser}
          confirmLabel={isTargetSuperuser ? "Revoke" : "Grant"}
          pending={setSuperuser.isPending}
          description={
            <p>
              {isTargetSuperuser
                ? "The account keeps its RBAC roles but loses the blanket bypass."
                : "This account will bypass every permission check in the backend."}
            </p>
          }
          onConfirm={async () => {
            try {
              await setSuperuser.mutateAsync(!isTargetSuperuser)
              toast.success(
                isTargetSuperuser ? "Superuser revoked." : "Superuser granted.",
              )
              setConfirmSuperuser(false)
              await effective.refetch()
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}
    </div>
  )
}
