import { CheckCircle2, ClipboardList, Loader2, RefreshCw, Wrench } from "lucide-react"
import * as React from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { useAccess } from "@/app/access"
import { EmptyState, ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { DataPagination } from "@/components/shared/pagination"
import { ProductionStatusBadge } from "@/components/shared/status-badge"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSession } from "@/features/auth/session"
import {
  useOrders,
  useUpdateOrderStatus,
} from "@/features/orders/hooks"
import type { Order } from "@/features/orders/types"
import { normalizeError } from "@/lib/api/errors"
import { formatDateTime, humanize } from "@/lib/format"
import type { DepartmentCode } from "@/lib/api/types"

const PAGE_SIZE = 10

/** Which department of this order belongs to the signed-in employee? */
function myDepartments(order: Order, userId: string): DepartmentCode[] {
  const departments: DepartmentCode[] = []
  if (order.cutting_man?.id === userId) departments.push("CUTTING")
  if (order.operator?.id === userId) departments.push("OPERATOR")
  return departments
}

/**
 * Quick completion control.
 *
 * Statuses are per department and the backend only accepts a transition from the
 * currently assigned employee (scope ASSIGNED) or a user with scope ALL. The
 * overall order status is recalculated server-side — never here.
 */
function CompleteButton({
  order,
  department,
}: {
  order: Order
  department: DepartmentCode
}) {
  const mutation = useUpdateOrderStatus(order.id)
  const current =
    department === "CUTTING" ? order.cutting_status : order.operator_status

  if (current === "COMPLETED") {
    return (
      <Button variant="outline" size="sm" disabled>
        <CheckCircle2 className="size-4" />
        Completed
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      disabled={mutation.isPending}
      onClick={async () => {
        try {
          await mutation.mutateAsync({ status: "COMPLETED", department })
          toast.success(`Order ${order.order_number} marked completed.`)
        } catch (error) {
          toast.error(normalizeError(error).detail)
        }
      }}
    >
      {mutation.isPending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <CheckCircle2 className="size-4" />
          Complete
        </>
      )}
    </Button>
  )
}

export function MyWorkPage() {
  const { user } = useSession()
  const { hasScope } = useAccess()
  const [scope, setScope] = React.useState<"active" | "all">("active")
  const [page, setPage] = React.useState(1)

  // One permission-scoped fetch; the "mine" slice is derived from assignments.
  const query = useOrders({
    page_size: 100,
    ordering: "-updated_at",
  })

  if (!user) return <LoadingState label="Loading your assignments…" />
  if (query.isPending) return <LoadingState label="Loading your work…" />
  if (query.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="My work" crumbs={[{ label: "My work" }]} />
        <ErrorState
          error={query.error}
          title="Could not load your assignments"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const adminScope = hasScope("production.update_status", "ALL")

  const mine = query.data.results.filter(
    (order) => myDepartments(order, user.id).length > 0,
  )
  const filtered =
    scope === "active"
      ? mine.filter((order) => order.overall_status !== "COMPLETED")
      : mine

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const pending = filtered.filter((order) =>
    myDepartments(order, user.id).some(
      (department) =>
        (department === "CUTTING" ? order.cutting_status : order.operator_status) ===
        "PENDING",
    ),
  ).length

  const myDepartmentLabels = Array.from(
    new Set(mine.flatMap((order) => myDepartments(order, user.id))),
  ).map((department) => humanize(department))

  return (
    <div className="space-y-5">
      <PageHeader
        title="My work"
        description="Orders assigned to you. Completing a department here credits your target exactly as the backend dictates."
        crumbs={[{ label: "My work" }]}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
            {adminScope ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/orders">
                  <ClipboardList className="size-4" />
                  All orders
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Assigned to you
            </p>
            <p className="text-2xl font-semibold tabular">{mine.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Awaiting your action
            </p>
            <p className="text-2xl font-semibold tabular">{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Departments
            </p>
            <p className="text-sm font-medium">
              {myDepartmentLabels.join(" · ") || "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Derived from your current order assignments
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b border-border py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Your assignments</CardTitle>
              <CardDescription>
                Only the department(s) you are assigned to can be completed by you.
              </CardDescription>
            </div>
            <Tabs
              value={scope}
              onValueChange={(value) => {
                setScope(value as "active" | "all")
                setPage(1)
              }}
            >
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="py-0">
          {visible.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title={scope === "active" ? "Nothing waiting for you" : "No assignments"}
              description={
                scope === "active"
                  ? "All of your assigned department work is completed."
                  : "You have not been assigned to any order yet."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((order) => {
                const departments = myDepartments(order, user.id)
                return (
                  <li key={order.id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/orders/${order.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {order.order_number}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          Updated {formatDateTime(order.updated_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{humanize(order.overall_status)}</Badge>
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/orders/${order.id}`}>Details</Link>
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {departments.map((department) => {
                        const status =
                          department === "CUTTING"
                            ? order.cutting_status
                            : order.operator_status
                        return (
                          <div
                            key={department}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                          >
                            <div className="space-y-1">
                              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                                {department === "CUTTING" ? "Cutting" : "Operator"}
                              </p>
                              <ProductionStatusBadge status={status} />
                            </div>
                            <CompleteButton order={order} department={department} />
                          </div>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>

        {filtered.length > 0 ? (
          <DataPagination
            page={currentPage}
            pageSize={PAGE_SIZE}
            count={filtered.length}
            onPageChange={setPage}
          />
        ) : null}
      </Card>

      {query.data.count > query.data.results.length ? (
        <Alert>
          <AlertDescription>
            This view shows the {query.data.results.length} most recently updated
            orders among the {query.data.count} you may access. Use the orders list
            for the complete, filterable history.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
