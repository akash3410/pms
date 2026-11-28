import { ArrowLeft, Power, RefreshCw, ShieldCheck, UserCog } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"

import { Can, useAccess } from "@/app/access"
import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/misc"
import {
  EditEmployeeDialog,
  EmployeeStatusDialog,
} from "@/features/employees/components/employee-dialogs"
import { employeesApi } from "@/features/employees/api"
import { formatDate, formatDateTime, humanize } from "@/lib/format"

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

export function EmployeeDetailsPage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const { can } = useAccess()
  const [editOpen, setEditOpen] = React.useState(false)
  const [statusOpen, setStatusOpen] = React.useState(false)

  const query = useQuery({
    queryKey: ["employees", "detail", employeeId],
    queryFn: () => employeesApi.get(employeeId as string),
    enabled: Boolean(employeeId),
  })

  if (!employeeId) {
    return <ErrorState error={new Error("Missing employee id")} title="Invalid employee link" />
  }
  if (query.isPending) return <LoadingState label="Loading employee…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/employees">
            <ArrowLeft className="size-4" />
            Back to employees
          </Link>
        </Button>
        <ErrorState
          error={query.error}
          title="Could not load this employee"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const employee = query.data
  const canManageAccess = can("users.manage_users")

  return (
    <div className="space-y-5">
      <PageHeader
        title={employee.full_name}
        description={`${employee.employee_code} · ${employee.role_display}`}
        crumbs={[{ label: "Employees", to: "/employees" }, { label: employee.employee_code }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/employees">
                <ArrowLeft className="size-4" />
                Employees
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
            <Can permission="employees.edit_employee">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <UserCog className="size-4" />
                Edit
              </Button>
            </Can>
            <Can permission="employees.deactivate_employee">
              <Button
                variant={employee.is_active ? "destructive" : "default"}
                size="sm"
                onClick={() => setStatusOpen(true)}
              >
                <Power className="size-4" />
                {employee.is_active ? "Deactivate" : "Reactivate"}
              </Button>
            </Can>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={employee.is_active ? "success" : "neutral"}>
          {employee.is_active ? "Active" : "Inactive"}
        </Badge>
        <Badge variant="outline">{employee.role_display}</Badge>
        {employee.email_verified_at ? (
          <Badge variant="success">Email verified</Badge>
        ) : (
          <Badge variant="warning">Email unverified</Badge>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Full name" value={employee.full_name} />
              <Detail label="Employee code" value={employee.employee_code} />
              <Detail label="Username" value={employee.username} />
              <Detail label="Email" value={employee.email || "—"} />
              <Detail
                label="Email verified"
                value={
                  employee.email_verified_at
                    ? formatDateTime(employee.email_verified_at)
                    : "Not verified"
                }
              />
              <Detail label="Joined" value={formatDate(employee.date_joined)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              RBAC roles drive authorization; the production role drives order
              assignment eligibility.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Active RBAC roles</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {employee.roles.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No roles — this account can authenticate but cannot do anything.
                  </span>
                ) : (
                  employee.roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Production role</p>
              <p className="text-sm font-medium">{humanize(employee.role)}</p>
            </div>

            {canManageAccess ? (
              <>
                <Separator />
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/users/${employee.id}`}>
                    <ShieldCheck className="size-4" />
                    Manage roles, scopes &amp; memberships
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Role and scope assignment requires the{" "}
                <code>users.manage_users</code> permission.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Can permission="employees.edit_employee">
        <EditEmployeeDialog
          employee={employee}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      </Can>

      <Can permission="employees.deactivate_employee">
        <EmployeeStatusDialog
          employee={employee}
          open={statusOpen}
          onOpenChange={setStatusOpen}
        />
      </Can>
    </div>
  )
}
