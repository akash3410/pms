import { ArrowRight, History, Loader2, MessageSquarePlus, StickyNote } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/feedback/states"
import { DataPagination } from "@/components/shared/pagination"
import { Can } from "@/app/access"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  useCreateOrderNote,
  useOrderAssignments,
  useOrderHistory,
  useOrderNotes,
} from "@/features/orders/hooks"
import { ProductionStatusBadge } from "@/components/shared/status-badge"
import { formatDateTime, humanize } from "@/lib/format"
import { normalizeError } from "@/lib/api/errors"
import type { NoteDepartment, UserRef } from "@/lib/api/types"

function person(user: UserRef | null): string {
  if (!user) return "—"
  return `${user.full_name} (${user.employee_code})`
}

/** Immutable assignment / reassignment trail. */
export function AssignmentHistoryTable({ orderId }: { orderId: string }) {
  const [page, setPage] = React.useState(1)
  const query = useOrderAssignments(orderId, page)
  const rows = query.data?.results ?? []

  if (query.isPending) return <TableSkeleton rows={4} columns={4} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (rows.length === 0)
    return (
      <EmptyState
        icon={History}
        title="No assignment history"
        description="Assignments are recorded automatically when an order is created or reassigned."
      />
    )

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Assigned by</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <Badge variant="outline">{humanize(entry.department)}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className={entry.previous_employee ? "" : "text-muted-foreground"}>
                    {entry.previous_employee ? person(entry.previous_employee) : "Unassigned"}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{person(entry.new_employee)}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {person(entry.assigned_by)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDateTime(entry.assigned_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DataPagination
        page={page}
        pageSize={10}
        count={query.data?.count ?? 0}
        onPageChange={setPage}
      />
    </div>
  )
}

/** Immutable production status trail. */
export function StatusHistoryTable({ orderId }: { orderId: string }) {
  const [page, setPage] = React.useState(1)
  const query = useOrderHistory(orderId, page)
  const rows = query.data?.results ?? []

  if (query.isPending) return <TableSkeleton rows={4} columns={4} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (rows.length === 0)
    return (
      <EmptyState
        icon={History}
        title="No status changes yet"
        description="Every real department status transition is recorded here."
      />
    )

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Department</TableHead>
            <TableHead>Transition</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <Badge variant="outline">{humanize(entry.department)}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {humanize(entry.previous_status)}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
                  <ProductionStatusBadge status={entry.new_status} />
                </div>
              </TableCell>
              <TableCell className="text-sm">{person(entry.employee)}</TableCell>
              <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                {entry.note || "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDateTime(entry.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DataPagination
        page={page}
        pageSize={10}
        count={query.data?.count ?? 0}
        onPageChange={setPage}
      />
    </div>
  )
}

/** Order notes with an inline composer. */
export function NotesPanel({
  orderId,
  defaultDepartment = "GENERAL",
}: {
  orderId: string
  defaultDepartment?: NoteDepartment
}) {
  const [page, setPage] = React.useState(1)
  const [body, setBody] = React.useState("")
  const [department, setDepartment] = React.useState<NoteDepartment>(defaultDepartment)
  const [error, setError] = React.useState<string | null>(null)
  const query = useOrderNotes(orderId, page)
  const createNote = useCreateOrderNote(orderId)
  const rows = query.data?.results ?? []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError("Write a note before saving.")
      return
    }
    try {
      await createNote.mutateAsync({ department, body: body.trim() })
      setBody("")
      setPage(1)
      toast.success("Note added.")
    } catch (caught) {
      const apiError = normalizeError(caught)
      setError(apiError.fieldErrors.body?.join(" ") || apiError.detail)
    }
  }

  return (
    <div className="space-y-4">
      <Can permission="orders.create_note">
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-2 rounded-lg border border-border bg-muted/30 p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">Add a note</p>
            <div className="w-full sm:w-44">
              <Select
                value={department}
                onValueChange={(value) => setDepartment(value as NoteDepartment)}
              >
                <SelectTrigger size="sm" aria-label="Note department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="CUTTING">Cutting</SelectItem>
                  <SelectItem value="OPERATOR">Operator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Describe a problem, decision or handover detail…"
            aria-label="Note body"
            maxLength={2000}
          />
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={createNote.isPending}>
              {createNote.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <MessageSquarePlus className="size-4" />
                  Add note
                </>
              )}
            </Button>
          </div>
        </form>
      </Can>

      {query.isPending ? (
        <TableSkeleton rows={3} columns={2} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Notes capture problems and context for this order."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((note) => (
              <li key={note.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{note.author.full_name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{note.author.employee_code}</span>
                  <Badge variant="outline">{humanize(note.department)}</Badge>
                  <span className="ml-auto">{formatDateTime(note.created_at)}</span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
          <DataPagination
            page={page}
            pageSize={10}
            count={query.data?.count ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
