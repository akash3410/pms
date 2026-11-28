import {
  Activity,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  Target,
  Trophy,
  Users,
} from "lucide-react"
import * as React from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Can } from "@/app/access"
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
} from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { OverallStatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Skeleton } from "@/components/ui/misc"
import { useSession } from "@/features/auth/session"
import {
  useDashboardReport,
  useProductionReport,
} from "@/features/reports/hooks"
import { formatNumber, humanize } from "@/lib/format"

const STATUS_COLORS: Record<string, string> = {
  PENDING: "var(--status-pending)",
  IN_PROGRESS: "var(--status-progress)",
  COMPLETED: "var(--status-completed)",
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: number | string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 py-1">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { user } = useSession()
  const dashboard = useDashboardReport()
  const production = useProductionReport()

  const refresh = () => {
    void dashboard.refetch()
    void production.refetch()
  }

  if (dashboard.isPending) {
    return (
      <div className="space-y-5">
        <PageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-56 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-56 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (dashboard.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Dashboard" />
        <ErrorState
          error={dashboard.error}
          title="Could not load dashboard statistics"
          onRetry={refresh}
        />
      </div>
    )
  }

  const data = dashboard.data
  const statusData = (["PENDING", "IN_PROGRESS", "COMPLETED"] as const).map(
    (status) => ({
      name: humanize(status),
      key: status,
      value: data.orders_by_status[status] ?? 0,
    }),
  )
  const departmentData = Object.entries(data.employees_by_department).map(
    ([code, count]) => ({ name: humanize(code), value: count }),
  )
  const roleData = Object.entries(data.employees_by_role).map(([code, count]) => ({
    name: humanize(code),
    value: count,
  }))
  const hasStatusData = statusData.some((entry) => entry.value > 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title={user ? `Welcome back, ${user.full_name.split(" ")[0]}` : "Dashboard"}
        description="Live production overview computed from the current database state."
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw
              className={dashboard.isFetching ? "size-4 animate-spin" : "size-4"}
            />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total orders"
          value={formatNumber(data.orders_total)}
          icon={ClipboardList}
          hint={`${formatNumber(data.orders_by_status.PENDING ?? 0)} pending`}
        />
        <KpiCard
          label="Completed today"
          value={formatNumber(data.orders_completed_today)}
          icon={CheckCircle2}
          hint="Orders finished on all departments today"
        />
        <KpiCard
          label="Active production staff"
          value={formatNumber(data.active_employees)}
          icon={Users}
          hint="Active members of production departments"
        />
        <KpiCard
          label="Completion rate"
          value={
            production.data
              ? `${Math.round(production.data.completion_rate_percent)}%`
              : "—"
          }
          icon={Activity}
          hint="Share of all orders fully completed"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label="Targets configured"
          value={formatNumber(data.targets_total)}
          icon={Target}
        />
        <KpiCard
          label="Completion credits"
          value={formatNumber(data.completion_credits_total)}
          icon={Trophy}
          hint="One credit per department completion"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
            <CardDescription>
              Overall order status across the whole system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasStatusData ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      strokeWidth={1}
                    >
                      {statusData.map((entry) => (
                        <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                      ))}
                    </Pie>
                    <ChartTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        fontSize: 12,
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={28}
                      formatter={(value) => (
                        <span className="text-xs text-muted-foreground">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="No orders recorded"
                description="Charts appear once orders exist."
                className="py-10"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employees by department</CardTitle>
            <CardDescription>
              Live department memberships of active accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {departmentData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentData} margin={{ left: -20, right: 8 }}>
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12 }}
                    />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--popover)",
                        color: "var(--popover-foreground)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="value" name="Employees" radius={[6, 6, 0, 0]} fill="var(--chart-1)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={Users}
                title="No department memberships"
                description="Assign employees to a department to see this chart."
                className="py-10"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Recent orders</CardTitle>
                <CardDescription>The five most recently created orders.</CardDescription>
              </div>
              <Can permission="orders.view_order">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/orders">View all</Link>
                </Button>
              </Can>
            </div>
          </CardHeader>
          <CardContent className="py-0">
            {data.recent_orders.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No orders yet"
                description="Create an order to start production tracking."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.recent_orders.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{order.order_number}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {order.cutting_man?.full_name ?? "Unassigned"} ·{" "}
                        {order.operator?.full_name ?? "Unassigned"}
                      </p>
                    </div>
                    <OverallStatusBadge status={order.overall_status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employees by role</CardTitle>
            <CardDescription>Active holders of each RBAC role.</CardDescription>
          </CardHeader>
          <CardContent>
            {roleData.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No role assignments"
                description="Assign roles to employees to see this breakdown."
                className="py-10"
              />
            ) : (
              <ul className="space-y-3">
                {roleData
                  .sort((a, b) => b.value - a.value)
                  .map((entry) => (
                    <li key={entry.name} className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{entry.name}</Badge>
                      <span className="text-sm font-medium tabular">
                        {formatNumber(entry.value)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {production.isError ? (
        <Alert>
          <AlertDescription>
            Completion rate is unavailable: {String((production.error as Error)?.message ?? "")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
