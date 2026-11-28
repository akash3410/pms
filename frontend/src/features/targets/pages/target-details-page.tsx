import { ArrowLeft, Pencil, RefreshCw } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router-dom"

import { Can } from "@/app/access"
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
import { Alert, AlertDescription } from "@/components/ui/misc"
import { TargetFormDialog } from "@/features/targets/components/target-form-dialog"
import { TargetProgress } from "@/features/targets/components/target-progress"
import { useTarget } from "@/features/targets/hooks"
import { daysInRange, formatDate, formatDateTime, humanize } from "@/lib/format"

export function TargetDetailsPage() {
  const { targetId } = useParams<{ targetId: string }>()
  const query = useTarget(targetId)
  const [editOpen, setEditOpen] = React.useState(false)

  if (!targetId) {
    return <ErrorState error={new Error("Missing target id")} title="Invalid target link" />
  }
  if (query.isPending) return <LoadingState label="Loading target…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/targets">
            <ArrowLeft className="size-4" />
            Back to targets
          </Link>
        </Button>
        <ErrorState
          error={query.error}
          title="Could not load this target"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const target = query.data
  const frozen = target.achieved_count > 0

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${target.employee.full_name} · ${humanize(target.department)}`}
        description={`${humanize(target.period_type)} target created ${formatDateTime(
          target.created_at,
        )} by ${target.created_by?.full_name ?? "—"}`}
        crumbs={[{ label: "Targets", to: "/targets" }, { label: "Details" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/targets">
                <ArrowLeft className="size-4" />
                Targets
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
            <Can permission="targets.manage_targets">
              <Button size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Edit target
              </Button>
            </Can>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Achievement</CardTitle>
            <CardDescription>
              Completion credits attributed to this target by the backend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TargetProgress
              achieved={target.achieved_count}
              target={target.target_count}
              className="max-w-xl"
            />
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Target</dt>
                <dd className="font-medium tabular">{target.target_count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Achieved</dt>
                <dd className="font-medium tabular">{target.achieved_count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Remaining</dt>
                <dd className="font-medium tabular">
                  {Math.max(0, target.target_count - target.achieved_count)}
                </dd>
              </div>
            </dl>
            {frozen ? (
              <Alert>
                <AlertDescription>
                  This target already holds completion credits, so the employee,
                  department, period type and date range are immutable. Only the
                  target count can still be adjusted.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Target definition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Employee</p>
              <p className="font-medium">{target.employee.full_name}</p>
              <p className="text-xs text-muted-foreground">
                {target.employee.employee_code}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Department</p>
              <Badge variant="outline">{humanize(target.department)}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Period type</p>
              <p className="font-medium">{humanize(target.period_type)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date range</p>
              <p className="font-medium">
                {formatDate(target.start_date)} – {formatDate(target.end_date)}
              </p>
              <p className="text-xs text-muted-foreground">
                {daysInRange(target.start_date, target.end_date)} days
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Can permission="targets.manage_targets">
        <TargetFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          target={target}
        />
      </Can>
    </div>
  )
}
