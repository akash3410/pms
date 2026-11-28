import { Plus, Power, UserCog, Users } from "lucide-react"
import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"

import { Can, useAccess } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  EditEmployeeDialog,
  EmployeeStatusDialog,
} from "@/features/employees/components/employee-dialogs"
import { employeesApi } from "@/features/employees/api"
import type { Employee } from "@/features/employees/types"
import { formatDate } from "@/lib/format"

const PAGE_SIZES = [10, 20, 50, 100]

export function EmployeesListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { can } = useAccess()

  const [editing, setEditing] = React.useState<Employee | null>(null)
  const [statusTarget, setStatusTarget] = React.useState<Employee | null>(null)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const requestedSize = Number(searchParams.get("page_size") ?? "20")
  const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : 20
  const search = searchParams.get("search") ?? ""
  const ordering = searchParams.get("ordering") ?? "employee_code"

  const query = useQuery({
    queryKey: ["employees", "list", { page, pageSize, search, ordering }],
    queryFn: () =>
      employeesApi.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        ordering,
      }),
    placeholderData: (previous) => previous,
  })

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key)
      else next.set(key, value)
    }
    if (!("page" in patch)) next.delete("page")
    setSearchParams(next, { replace: true })
  }

  const rows = query.data?.results ?? []
  const canEdit = can("employees.edit_employee")
  const canChangeStatus = can("employees.deactivate_employee")

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Accounts are deactivated, never deleted, so production history stays intact."
        crumbs={[{ label: "Employees" }]}
        actions={
          <Can permission="employees.create_employee">
            <Button asChild>
              <Link to="/employees/new">
                <Plus className="size-4" />
                New employee
              </Link>
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Name, code, username or email…"
            label="Search employees"
          />
          <FilterSelect
            label="Sort employees"
            placeholder="Sort"
            value={ordering}
            allLabel="Employee code ↑"
            onChange={(value) => updateParams({ ordering: value })}
            options={[
              { value: "-employee_code", label: "Employee code ↓" },
              { value: "full_name", label: "Name ↑" },
              { value: "-full_name", label: "Name ↓" },
              { value: "-date_joined", label: "Newest first" },
            ]}
          />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? "No employees match this search" : "No employees yet"}
            description={
              search
                ? "Try a different name, employee code, username or email."
                : "Create the first employee account, or invite one by email."
            }
            action={
              <Can permission="employees.create_employee">
                <Button size="sm" asChild>
                  <Link to="/employees/new">
                    <Plus className="size-4" />
                    New employee
                  </Link>
                </Button>
              </Can>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>RBAC roles</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell>
                        <Link
                          to={`/employees/${employee.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {employee.full_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {employee.employee_code}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {employee.username}
                      </TableCell>
                      <TableCell className="text-sm">{employee.role_display}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {employee.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">None</span>
                          ) : (
                            employee.roles.map((role) => (
                              <Badge key={role} variant="outline">
                                {role}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={employee.is_active ? "success" : "neutral"}>
                          {employee.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(employee.date_joined)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(employee)}
                            >
                              <UserCog className="size-4" />
                              Edit
                            </Button>
                          ) : null}
                          {canChangeStatus ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatusTarget(employee)}
                            >
                              <Power className="size-4" />
                              {employee.is_active ? "Deactivate" : "Reactivate"}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {rows.map((employee) => (
                <li key={employee.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        to={`/employees/${employee.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {employee.full_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {employee.employee_code} · {employee.username}
                      </p>
                    </div>
                    <Badge variant={employee.is_active ? "success" : "neutral"}>
                      {employee.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {employee.role_display}
                    {employee.roles.length > 0
                      ? ` · ${employee.roles.join(", ")}`
                      : " · no RBAC roles"}
                  </p>
                  <div className="flex gap-1">
                    {canEdit ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(employee)}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canChangeStatus ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStatusTarget(employee)}
                      >
                        {employee.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/employees/${employee.id}`)}
                    >
                      View
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {query.data && query.data.count > 0 ? (
          <DataPagination
            page={page}
            pageSize={pageSize}
            count={query.data.count}
            onPageChange={(next) => updateParams({ page: String(next) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>

      {editing ? (
        <EditEmployeeDialog
          employee={editing}
          open
          onOpenChange={(next) => !next && setEditing(null)}
        />
      ) : null}

      {statusTarget ? (
        <EmployeeStatusDialog
          employee={statusTarget}
          open
          onOpenChange={(next) => !next && setStatusTarget(null)}
        />
      ) : null}
    </div>
  )
}
