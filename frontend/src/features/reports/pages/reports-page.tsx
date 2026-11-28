import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { FileBarChart2 } from "lucide-react"
import * as React from "react"

import { EmptyState, ErrorState, LoadingState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/misc"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useEmployeePerformanceReport,
  useProductionReport,
  useTargetsReport,
} from "@/features/reports/hooks"
import { formatDate, humanize } from "@/lib/format"
import type { ProductionStatus } from "@/lib/api/types"

const WINDOW_SIZE = 100

function ProductionSection() {
  const query = useProductionReport()

  if (query.isPending) return <LoadingState label="Loading production report…" />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const report = query.data
  const rows = (["PENDING", "IN_PROGRESS", "COMPLETED"] as ProductionStatus[]).map(
    (status) => ({
      status: humanize(status),
      cutting: report.cutting[status] ?? 0,
      operator: report.operator[status] ?? 0,
    }),
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Total orders</p>
            <p className="text-2xl font-semibold tabular">{report.total_orders}</p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Completed orders</p>
            <p className="text-2xl font-semibold tabular">{report.completed_orders}</p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent>
            <p className="text-xs text-muted-foreground">Completion rate</p>
            <p className="text-2xl font-semibold tabular">
              {report.completion_rate_percent.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status distribution by department</CardTitle>
          <CardDescription>
            Counted from production records, not derived in the browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="status" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Bar dataKey="cutting" name="Cutting" radius={[4, 4, 0, 0]} fill="var(--chart-1)" />
                <Bar dataKey="operator" name="Operator" radius={[4, 4, 0, 0]} fill="var(--chart-2)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-[var(--chart-1)]" /> Cutting
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-[var(--chart-2)]" /> Operator
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function EmployeeSection() {
  const [offset, setOffset] = React.useState(0)
  const query = useEmployeePerformanceReport({ limit: WINDOW_SIZE, offset })

  if (query.isPending) return <TableSkeleton rows={6} columns={4} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const rows = [...query.data].sort((a, b) => b.completion_credits - a.completion_credits)
  const maxCredits = Math.max(1, ...rows.map((row) => row.completion_credits))

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart2}
        title="No employee activity"
        description="Employee performance appears once assignments exist."
      />
    )
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead className="text-right">Cutting assigned</TableHead>
            <TableHead className="text-right">Operator assigned</TableHead>
            <TableHead>Completion credits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.employee.id}>
              <TableCell>
                <p className="font-medium">{row.employee.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.employee.employee_code} · {humanize(row.employee.role)}
                  {!row.employee.is_active ? " · inactive" : ""}
                </p>
              </TableCell>
              <TableCell className="text-right tabular">{row.cutting_assigned}</TableCell>
              <TableCell className="text-right tabular">{row.operator_assigned}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress
                    value={(row.completion_credits / maxCredits) * 100}
                    className="h-1.5 w-24"
                  />
                  <span className="text-sm tabular">{row.completion_credits}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {offset + 1}–{offset + rows.length}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - WINDOW_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={query.data.length < WINDOW_SIZE}
            onClick={() => setOffset(offset + WINDOW_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

function TargetSection() {
  const [offset, setOffset] = React.useState(0)
  const query = useTargetsReport({ limit: WINDOW_SIZE, offset })

  if (query.isPending) return <TableSkeleton rows={6} columns={4} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const rows = query.data
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No targets to report"
        description="Create employee targets to see achievement data here."
      />
    )
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead className="text-right">Achieved</TableHead>
            <TableHead>Achievement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.target_id}>
              <TableCell>
                <p className="font-medium">{row.employee.full_name}</p>
                <p className="text-xs text-muted-foreground">{row.employee.employee_code}</p>
              </TableCell>
              <TableCell className="text-sm">{humanize(row.department)}</TableCell>
              <TableCell className="text-sm">
                {humanize(row.period_type)}
                <span className="block text-xs text-muted-foreground">
                  {formatDate(row.start_date)} – {formatDate(row.end_date)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular">{row.target_count}</TableCell>
              <TableCell className="text-right tabular">{row.achieved}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress
                    value={Math.min(100, row.achievement_percent)}
                    className="h-1.5 w-24"
                  />
                  <span className="text-sm tabular">
                    {row.achievement_percent.toFixed(0)}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {offset + 1}–{offset + rows.length}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - WINDOW_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < WINDOW_SIZE}
            onClick={() => setOffset(offset + WINDOW_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ReportsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Aggregate figures computed server-side from live orders, assignments and targets."
        crumbs={[{ label: "Reports" }]}
      />

      <Card className="gap-0 py-0">
        <Tabs defaultValue="production" className="gap-0">
          <div className="border-b border-border p-4">
            <TabsList>
              <TabsTrigger value="production">Production</TabsTrigger>
              <TabsTrigger value="employees">Employee performance</TabsTrigger>
              <TabsTrigger value="targets">Targets</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="production" className="p-4">
            <ProductionSection />
          </TabsContent>
          <TabsContent value="employees" className="p-4">
            <EmployeeSection />
          </TabsContent>
          <TabsContent value="targets" className="p-4">
            <TargetSection />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  )
}
