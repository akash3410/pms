import { ScrollText } from "lucide-react"
import * as React from "react"
import { useSearchParams } from "react-router-dom"

import { EmptyState, ErrorState, TableSkeleton } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FilterSelect, SearchInput, Toolbar } from "@/components/shared/list-toolbar"
import { DataPagination } from "@/components/shared/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAuditTrail } from "@/features/rbac/hooks"
import type { AuditLog } from "@/features/audit/types"
import { formatDateTime, humanize } from "@/lib/format"

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-xs text-muted-foreground">No data</p>
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function AuditDetailDialog({
  log,
  onOpenChange,
}: {
  log: AuditLog
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{humanize(log.action.replace(/\./g, " "))}</DialogTitle>
          <DialogDescription>
            {log.actor_label || "system"} · {formatDateTime(log.created_at)}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Action</dt>
            <dd>
              <code>{log.action}</code>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Target</dt>
            <dd>
              <code>
                {log.target_type}:{log.target_id || "—"}
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Actor</dt>
            <dd>{log.actor_label || "system"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Request id</dt>
            <dd>
              <code className="text-xs">{log.request_id || "—"}</code>
            </dd>
          </div>
        </dl>

        <div className="space-y-3">
          <section>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
              Before
            </h4>
            <JsonBlock value={log.before} />
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
              After
            </h4>
            <JsonBlock value={log.after} />
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
              Metadata
            </h4>
            <JsonBlock value={log.metadata} />
          </section>
        </div>

        <p className="text-xs text-muted-foreground">
          Audit records are immutable; the API exposes no edit or delete route.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Frequently used action prefixes, offered as quick filters. */
const ACTION_SUGGESTIONS = [
  "order.",
  "production.",
  "user.",
  "role.",
  "department.",
  "invitation.",
  "target.",
  "system.",
]

export function AuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = React.useState<AuditLog | null>(null)

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const pageSize = [20, 50, 100].includes(Number(searchParams.get("page_size")))
    ? Number(searchParams.get("page_size"))
    : 20
  const search = searchParams.get("search") ?? ""
  const action = searchParams.get("action") ?? ""
  const targetType = searchParams.get("target_type") ?? ""
  const ordering = searchParams.get("ordering") === "created_at" ? "created_at" : "-created_at"

  const query = useAuditTrail({
    page,
    page_size: pageSize,
    search: search || undefined,
    action: action || undefined,
    target_type: targetType || undefined,
    ordering,
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Append-only security trail. Rows can never be edited or deleted from this interface."
        crumbs={[{ label: "Audit log" }]}
      />

      <Card className="gap-0 overflow-hidden py-0">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => updateParams({ search: value || undefined })}
            placeholder="Action, target, actor or request id…"
            label="Search audit log"
          />
          <div className="w-44">
            <Input
              value={action}
              onChange={(event) => updateParams({ action: event.target.value })}
              placeholder="Exact action"
              aria-label="Filter by exact action"
              className="h-8 text-xs"
            />
          </div>
          <div className="w-44">
            <Input
              value={targetType}
              onChange={(event) => updateParams({ target_type: event.target.value })}
              placeholder="Target type"
              aria-label="Filter by target type"
              className="h-8 text-xs"
            />
          </div>
          <FilterSelect
            label="Sort order"
            placeholder="Newest first"
            value={ordering === "created_at" ? "created_at" : undefined}
            onChange={(value) => updateParams({ ordering: value })}
            options={[{ value: "created_at", label: "Oldest first" }]}
          />
        </Toolbar>

        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          <span className="self-center text-xs text-muted-foreground">Quick filters:</span>
          {ACTION_SUGGESTIONS.map((prefix) => (
            <Button
              key={prefix}
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => updateParams({ search: prefix })}
            >
              {prefix}*
            </Button>
          ))}
        </div>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={4} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events"
            description="Events appear here as soon as actions are performed."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{log.action}</code>
                  </TableCell>
                  <TableCell className="text-sm">{log.actor_label || "system"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.target_type}</Badge>
                    {log.target_id ? (
                      <code className="ml-1 text-xs text-muted-foreground">
                        {log.target_id.slice(0, 8)}
                      </code>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(log)}>
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
            page={page}
            pageSize={pageSize}
            count={query.data.count}
            pageSizeOptions={[20, 50, 100]}
            onPageChange={(next) => updateParams({ page: String(next) })}
            onPageSizeChange={(size) =>
              updateParams({ page_size: String(size), page: "1" })
            }
          />
        ) : null}
      </Card>

      {selected ? (
        <AuditDetailDialog
          log={selected}
          onOpenChange={(next) => !next && setSelected(null)}
        />
      ) : null}
    </div>
  )
}
