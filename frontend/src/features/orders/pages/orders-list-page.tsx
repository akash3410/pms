import { ClipboardList, Plus } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import { Can } from "@/app/access"
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { DataPagination } from "@/components/shared/pagination"
import {
  ClearFiltersButton,
  FilterSelect,
  SearchInput,
  Toolbar,
} from "@/components/shared/list-toolbar"
import {
  OverallStatusBadge,
  ProductionStatusBadge,
} from "@/components/shared/status-badge"
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
import { useOrders } from "@/features/orders/hooks"
import type { Order, OrderListParams } from "@/features/orders/types"
import type { OverallStatus, ProductionStatus } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"

function assigneeLabel(
  person: Order["cutting_man"],
): { name: string; code: string } {
  if (!person) return { name: "Unassigned", code: "" }
  return { name: person.full_name, code: person.employee_code }
}

function orderSearchParams(
  params: URLSearchParams,
): Required<Pick<OrderListParams, "page" | "page_size">> & OrderListParams {
  const page = Number(params.get("page") ?? "1")
  const pageSize = Number(params.get("page_size") ?? "20")
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: [10, 20, 50, 100].includes(pageSize) ? pageSize : 20,
    search: params.get("search") ?? undefined,
    ordering: params.get("ordering") ?? "-created_at",
    overall_status: (params.get("overall_status") as OverallStatus) ?? undefined,
    cutting_status: (params.get("cutting_status") as ProductionStatus) ?? undefined,
    operator_status: (params.get("operator_status") as ProductionStatus) ?? undefined,
  }
}

export function OrdersListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const params = orderSearchParams(searchParams)
  const query = useOrders(params)

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key)
      else next.set(key, value)
    }
    // Any filter change resets pagination, except an explicit page change.
    if (!("page" in patch)) next.delete("page")
    setSearchParams(next, { replace: true })
  }

  const hasFilters = Boolean(
    params.search ||
      params.overall_status ||
      params.cutting_status ||
      params.operator_status,
  )

  const clearFilters = () => {
    const next = new URLSearchParams()
    if (params.page_size !== 20) next.set("page_size", String(params.page_size))
    setSearchParams(next, { replace: true })
  }

  const orders = query.data?.results ?? []
  const total = query.data?.count ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Every production order you can access, with its current assignments and derived status."
        crumbs={[{ label: "Orders" }]}
        actions={
          <Can permission="orders.create_order">
            <Button asChild>
              <Link to="/orders/new">
                <Plus className="size-4" />
                New order
              </Link>
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={params.search ?? ""}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Order number, cutting man, operator…"
            label="Search orders"
          />
          <FilterSelect
            label="Filter by overall status"
            placeholder="Overall status"
            value={params.overall_status}
            onChange={(value) =>
              updateParams({ overall_status: value as OverallStatus | undefined })
            }
            options={[
              { value: "PENDING", label: "Pending" },
              { value: "IN_PROGRESS", label: "In progress" },
              { value: "COMPLETED", label: "Completed" },
            ]}
          />
          <FilterSelect
            label="Filter by cutting status"
            placeholder="Cutting"
            value={params.cutting_status}
            onChange={(value) =>
              updateParams({
                cutting_status: value as ProductionStatus | undefined,
              })
            }
            options={[
              { value: "PENDING", label: "Cutting: pending" },
              { value: "COMPLETED", label: "Cutting: completed" },
            ]}
          />
          <FilterSelect
            label="Filter by operator status"
            placeholder="Operator"
            value={params.operator_status}
            onChange={(value) =>
              updateParams({
                operator_status: value as ProductionStatus | undefined,
              })
            }
            options={[
              { value: "PENDING", label: "Operator: pending" },
              { value: "COMPLETED", label: "Operator: completed" },
            ]}
          />
          <ClearFiltersButton active={hasFilters} onClear={clearFilters} />
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={hasFilters ? "No orders match these filters" : "No orders yet"}
            description={
              hasFilters
                ? "Try a different search term or clear the filters."
                : "Create the first production order to get started."
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Can permission="orders.create_order">
                  <Button asChild size="sm">
                    <Link to="/orders/new">
                      <Plus className="size-4" />
                      New order
                    </Link>
                  </Button>
                </Can>
              )
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Cutting</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Overall</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const cutting = assigneeLabel(order.cutting_man)
                    const operator = assigneeLabel(order.operator)
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link
                            to={`/orders/${order.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {order.order_number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="text-sm">{cutting.name}</p>
                            <ProductionStatusBadge status={order.cutting_status} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="text-sm">{operator.name}</p>
                            <ProductionStatusBadge status={order.operator_status} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <OverallStatusBadge status={order.overall_status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(order.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/orders/${order.id}`)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-border md:hidden">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="block space-y-2 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{order.order_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(order.created_at)}
                        </p>
                      </div>
                      <OverallStatusBadge status={order.overall_status} />
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Cutting</dt>
                        <dd className="font-medium">
                          {assigneeLabel(order.cutting_man).name}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Operator</dt>
                        <dd className="font-medium">
                          {assigneeLabel(order.operator).name}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {query.data && total > 0 ? (
          <DataPagination
            page={params.page}
            pageSize={params.page_size}
            count={total}
            onPageChange={(page) => updateParams({ page: String(page) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>
    </div>
  )
}
