import { ArrowLeft, Loader2, RefreshCw, UserMinus, UserPlus } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import { useAccess } from "@/app/access"
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from "@/components/feedback/states"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useAddDepartmentMember,
  useDepartment,
  useDepartmentMembers,
  useEmployeeDirectory,
  useEndMembership,
  useSetPrimaryMembership,
  useUpdateDepartment,
} from "@/features/rbac/hooks"
import type { DepartmentMembership } from "@/features/rbac/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDate, formatDateTime } from "@/lib/format"

export function DepartmentDetailsPage() {
  const { departmentId } = useParams<{ departmentId: string }>()
  const { can } = useAccess()
  const query = useDepartment(departmentId)
  const update = useUpdateDepartment(departmentId ?? "")
  const members = useDepartmentMembers(departmentId, true)
  const directory = useEmployeeDirectory(Boolean(departmentId))
  const addMember = useAddDepartmentMember(departmentId ?? "")
  const endMembership = useEndMembership(departmentId ?? "")
  const setPrimary = useSetPrimaryMembership(departmentId ?? "")

  const [formError, setFormError] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [isProduction, setIsProduction] = React.useState(true)
  const [selectedUser, setSelectedUser] = React.useState("")
  const [makePrimary, setMakePrimary] = React.useState(false)
  const [ending, setEnding] = React.useState<DepartmentMembership | null>(null)
  const [showEnded, setShowEnded] = React.useState(false)

  React.useEffect(() => {
    if (!query.data) return
    setName(query.data.name)
    setDescription(query.data.description)
    setIsProduction(query.data.is_production)
  }, [query.data])

  if (!departmentId) {
    return <ErrorState error={new Error("Missing department id")} title="Invalid department link" />
  }
  if (query.isPending) return <LoadingState label="Loading department…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/departments">
            <ArrowLeft className="size-4" />
            Back to departments
          </Link>
        </Button>
        <ErrorState
          error={query.error}
          title="Could not load this department"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const department = query.data
  const canManageDepartment = can("departments.manage_departments")
  const canManageMembers = can("departments.manage_members")

  const visibleMemberships = (members.data ?? []).filter((membership) =>
    showEnded ? true : membership.ended_at === null,
  )

  const saveDetails = async () => {
    setFormError(null)
    try {
      await update.mutateAsync({ name, description, is_production: isProduction })
      toast.success("Department updated.")
    } catch (error) {
      setFormError(normalizeError(error).detail)
    }
  }

  const toggleActive = async () => {
    try {
      await update.mutateAsync({ is_active: !department.is_active })
      toast.success(
        `Department ${department.code} ${department.is_active ? "deactivated" : "activated"}.`,
      )
    } catch (error) {
      toast.error(normalizeError(error).detail)
    }
  }

  const submitMember = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedUser) {
      toast.error("Select an employee to add.")
      return
    }
    try {
      await addMember.mutateAsync({ userId: selectedUser, isPrimary: makePrimary })
      toast.success("Member added.")
      setSelectedUser("")
      setMakePrimary(false)
    } catch (error) {
      toast.error(normalizeError(error).detail)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={department.name}
        description={department.description || "No description provided."}
        crumbs={[
          { label: "Departments", to: "/admin/departments" },
          { label: department.code },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/departments">
                <ArrowLeft className="size-4" />
                Departments
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
            {canManageDepartment ? (
              <Button
                variant={department.is_active ? "destructive" : "default"}
                size="sm"
                disabled={update.isPending}
                onClick={() => void toggleActive()}
              >
                {department.is_active ? "Deactivate" : "Activate"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{department.code}</code>
        <Badge variant={department.is_active ? "success" : "neutral"}>
          {department.is_active ? "Active" : "Inactive"}
        </Badge>
        <Badge variant={department.is_production ? "info" : "outline"}>
          {department.is_production ? "Production" : "Support"}
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Department details</CardTitle>
            <CardDescription>
              The code cannot change. Deactivating keeps memberships and history intact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="dept-name">Name</Label>
              <Input
                id="dept-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canManageDepartment}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-description">Description</Label>
              <Textarea
                id="dept-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canManageDepartment}
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="dept-production"
                checked={isProduction}
                disabled={!canManageDepartment}
                onCheckedChange={(checked) => setIsProduction(checked === true)}
              />
              <div>
                <Label htmlFor="dept-production">Production department</Label>
                <p className="text-xs text-muted-foreground">
                  Drives production reports, targets and order assignment rules.
                </p>
              </div>
            </div>

            {canManageDepartment ? (
              <Button size="sm" onClick={() => void saveDetails()} disabled={update.isPending}>
                {update.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save details"
                )}
              </Button>
            ) : null}

            <Separator />
            <p className="text-xs text-muted-foreground">
              Created {formatDate(department.created_at)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Departmental scope uses these memberships, including one optional
              primary department per employee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManageMembers ? (
              <form
                onSubmit={(event) => void submitMember(event)}
                className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={selectedUser}
                    onValueChange={setSelectedUser}
                    disabled={directory.isPending}
                  >
                    <SelectTrigger aria-label="Employee to add">
                      <SelectValue
                        placeholder={
                          directory.isPending ? "Loading employees…" : "Select an employee"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(directory.data ?? []).map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.full_name} · {employee.employee_code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" size="sm" disabled={addMember.isPending}>
                    <UserPlus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="primary-membership"
                    checked={makePrimary}
                    onCheckedChange={(checked) => setMakePrimary(checked === true)}
                  />
                  <Label htmlFor="primary-membership" className="text-xs">
                    Make this the employee's primary department
                  </Label>
                </div>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Adding or removing members requires <code>departments.manage_members</code>.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="show-ended"
                checked={showEnded}
                onCheckedChange={(checked) => setShowEnded(checked === true)}
              />
              <Label htmlFor="show-ended" className="text-xs">
                Include ended memberships
              </Label>
            </div>

            {members.isPending ? (
              <TableSkeleton rows={3} columns={3} />
            ) : members.isError ? (
              <ErrorState error={members.error} onRetry={() => void members.refetch()} />
            ) : visibleMemberships.length === 0 ? (
              <EmptyState
                title="No members"
                description="Add an employee to make this department part of their access scope."
                className="py-10"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Primary</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMemberships.map((membership) => (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <Link
                          to={`/admin/users/${membership.user_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {membership.user_label}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {membership.is_primary ? (
                          <Badge variant="info">Primary</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(membership.created_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {membership.ended_at ? formatDate(membership.ended_at) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManageMembers && !membership.ended_at ? (
                          <div className="flex justify-end gap-1">
                            {!membership.is_primary ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={setPrimary.isPending}
                                onClick={async () => {
                                  try {
                                    await setPrimary.mutateAsync(membership.id)
                                    toast.success("Primary department updated.")
                                  } catch (error) {
                                    toast.error(normalizeError(error).detail)
                                  }
                                }}
                              >
                                Set primary
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEnding(membership)}
                            >
                              <UserMinus className="size-4" />
                              End
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {ending ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setEnding(null)}
          title="End this membership?"
          destructive
          confirmLabel="End membership"
          pending={endMembership.isPending}
          description={
            <>
              <p>
                <strong>{ending.user_label}</strong> loses departmental scope for{" "}
                {department.name}. Historical orders and credits are unaffected.
              </p>
              <p>The membership row is closed, never deleted.</p>
            </>
          }
          onConfirm={async () => {
            try {
              await endMembership.mutateAsync(ending.id)
              toast.success("Membership ended.")
              setEnding(null)
            } catch (error) {
              toast.error(normalizeError(error).detail)
            }
          }}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Last updated {formatDateTime(department.updated_at)}
      </p>
    </div>
  )
}
