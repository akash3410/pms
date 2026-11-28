import { Plus, Target } from "lucide-react"
import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import { Can } from "@/app/access"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import {
  ClearFiltersButton,
  FilterSelect,
  Toolbar,
} from "@/components/shared/list-toolbar"
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
import { TargetFormDialog } from "@/features/targets/components/target-form-dialog"
import { TargetProgress } from "@/features/targets/components/target-progress"
import { useTargets } from "@/features/targets/hooks"
import type { TargetListParams } from "@/features/targets/types"
import { formatDate, humanize } from "@/lib/format"
import {
  PERIOD_TYPES,
  type DepartmentCode,
  type PeriodType,
} from "@/lib/api/types"

export function TargetsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = React.useState(false)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [10, 20, 50].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const params: TargetListParams = {
    page: Number.isFinite(page) ? page : 1,
    page_size: pageSize,
    department: (searchParams.get("department") as DepartmentCode) ?? undefined,
    period_type: (searchParams.get("period_type") as PeriodType) ?? undefined,
    ordering: searchParams.get("ordering") ?? "-start_date",
  }

  const query = useTargets(params)

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key)
      else next.set(key, value)
    }
    if (!("page" in patch)) next.delete("page")
    setSearchParams(next, { replace: true })
  }

  const hasFilters = Boolean(params.department || params.period_type)
  const rows = query.data?.results ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Targets"
        description="Per-employee production targets. Achievement counts come from completion credits awarded when a department completes an order."
        crumbs={[{ label: "Targets" }]}
        actions={
          <Can permission="targets.manage_targets">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New target
            </Button>
          </Can>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <FilterSelect
              label="Filter by department"
              placeholder="Department"
              value={params.department}
              onChange={(value) =>
                updateParams({ department: value as DepartmentCode | undefined })
              }
              options={[
                { value: "CUTTING", label: "Cutting" },
                { value: "OPERATOR", label: "Operator" },
              ]}
            />
            <FilterSelect
              label="Filter by period type"
              placeholder="Period"
              value={params.period_type}
              onChange={(value) =>
                updateParams({ period_type: value as PeriodType | undefined })
              }
              options={PERIOD_TYPES.map((period) => ({
                value: period.value,
                label: period.label,
              }))}
            />
            <FilterSelect
              label="Sort targets"
              placeholder="Sort"
              value={params.ordering}
              allLabel="Newest first"
              onChange={(value) => updateParams({ ordering: value })}
              options={[
                { value: "start_date", label: "Start date ↑" },
                { value: "-start_date", label: "Start date ↓" },
                { value: "created_at", label: "Created ↑" },
                { value: "-created_at", label: "Created ↓" },
              ]}
            />
            <ClearFiltersButton
              active={hasFilters}
              onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
            />
          </div>
        </Toolbar>

        {query.isPending ? (
          <TableSkeleton rows={6} columns={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title={hasFilters ? "No targets match these filters" : "No targets configured"}
            description={
              hasFilters
                ? "Clear the filters to see all targets."
                : "Create a target to start tracking an employee's expected output."
            }
            action={
              <Can permission="targets.manage_targets">
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New target
                </Button>
              </Can>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Date range</TableHead>
                <TableHead className="w-[180px]">Achievement</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((target) => (
                <TableRow key={target.id}>
                  <TableCell>
                    <Link
                      to={`/targets/${target.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {target.employee.full_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {target.employee.employee_code}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{humanize(target.department)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {humanize(target.period_type)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(target.start_date)} – {formatDate(target.end_date)}
                  </TableCell>
                  <TableCell>
                    <TargetProgress
                      achieved={target.achieved_count}
                      target={target.target_count}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/targets/${target.id}`)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {query.data && query.data.count > 0 ? (
          <DataPagination
            page={params.page ?? 1}
            pageSize={pageSize}
            count={query.data.count}
            pageSizeOptions={[10, 20, 50]}
            onPageChange={(next) => updateParams({ page: String(next) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>

      <Can permission="targets.manage_targets">
        <TargetFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      </Can>
    </div>
  )
}
