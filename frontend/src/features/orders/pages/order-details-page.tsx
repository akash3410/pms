import {
  ArrowLeft,
  History,
  ImageIcon,
  ListChecks,
  Pencil,
  RefreshCw,
  StickyNote,
  UserRoundCog,
} from "lucide-react"
import * as React from "react"
import { useForm } from "react-hook-form"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { useAccess } from "@/app/access"
import { ErrorState, LoadingState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { AuthenticatedImage } from "@/components/shared/authenticated-image"
import { FormField } from "@/components/shared/form-field"
import {
  OverallStatusBadge,
  ProductionStatusBadge,
} from "@/components/shared/status-badge"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AssignDialog } from "@/features/orders/components/assign-dialog"
import {
  AssignmentHistoryTable,
  NotesPanel,
  StatusHistoryTable,
} from "@/features/orders/components/order-activity"
import { StatusUpdateDialog } from "@/features/orders/components/status-dialog"
import { useOrder, useUpdateOrder } from "@/features/orders/hooks"
import type { Order } from "@/features/orders/types"
import { useSession } from "@/features/auth/session"
import { formatDateTime, humanize } from "@/lib/format"
import { normalizeError } from "@/lib/api/errors"
import type { DepartmentCode, UserRef } from "@/lib/api/types"

const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

function PersonCell({ person }: { person: UserRef | null }) {
  if (!person) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>
  }
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{person.full_name}</p>
      <p className="text-xs text-muted-foreground">{person.employee_code}</p>
    </div>
  )
}

const editSchema = z.object({
  order_number: z
    .string()
    .trim()
    .min(1, "Order number is required.")
    .max(64, "At most 64 characters.")
    .regex(ORDER_NUMBER_PATTERN, "Invalid characters for an order number."),
})
type EditValues = z.infer<typeof editSchema>

function EditOrderDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mutation = useUpdateOrder(order.id)
  const [file, setFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { order_number: order.order_number },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({ order_number: order.order_number })
      setFile(null)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.order_number])

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    if (file) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Choose a JPG, PNG or WebP image.")
        return
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError("The image must be 10 MB or smaller.")
        return
      }
    }
    try {
      await mutation.mutateAsync({
        order_number: values.order_number,
        ...(file ? { original_image: file } : {}),
      })
      toast.success("Order updated.")
      onOpenChange(false)
    } catch (caught) {
      const apiError = normalizeError(caught)
      setError(apiError.detail)
      for (const [field, messages] of Object.entries(apiError.fieldErrors)) {
        if (field === "order_number") {
          form.setError("order_number", { message: messages.join(" ") })
        }
      }
    }
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit order</DialogTitle>
          <DialogDescription>
            Replacing the original regenerates the order-card image from the new
            upload. Statuses are never edited here.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="edit_order_number"
            label="Order number"
            required
            error={form.formState.errors.order_number?.message}
          >
            <Input id="edit_order_number" {...form.register("order_number")} />
          </FormField>

          <FormField
            id="edit_original_image"
            label="Replace original image"
            description="Optional. JPG, PNG or WebP up to 10 MB."
          >
            <Input
              id="edit_original_image"
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OrderDetailsPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const query = useOrder(orderId)
  const { user } = useSession()
  const { can, hasScope } = useAccess()

  const [assignDept, setAssignDept] = React.useState<DepartmentCode | null>(null)
  const [statusDept, setStatusDept] = React.useState<DepartmentCode | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)

  if (!orderId) {
    return <ErrorState error={new Error("Missing order id")} title="Invalid order link" />
  }

  if (query.isPending) return <LoadingState label="Loading order…" />
  if (query.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/orders">
            <ArrowLeft className="size-4" />
            Back to orders
          </Link>
        </Button>
        <ErrorState
          error={query.error}
          title="Could not load this order"
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }

  const order = query.data
  const adminStatusScope = hasScope("production.update_status", "ALL")
  const canUpdateStatus = can("production.update_status")
  const canAssign = can("orders.assign_order")
  const canEdit = can("orders.edit_order")

  /** Employees may only act on a department they currently hold. */
  const assignedDepartments: DepartmentCode[] = []
  if (user) {
    if (order.cutting_man?.id === user.id) assignedDepartments.push("CUTTING")
    if (order.operator?.id === user.id) assignedDepartments.push("OPERATOR")
  }

  const statusDepartments: DepartmentCode[] = adminStatusScope
    ? ["CUTTING", "OPERATOR"]
    : assignedDepartments

  const tabs = [
    can("orders.view_assignments")
      ? { value: "assignments", label: "Assignments", icon: History }
      : null,
    can("orders.view_history")
      ? { value: "history", label: "Status history", icon: ListChecks }
      : null,
    can("orders.view_notes")
      ? { value: "notes", label: "Notes", icon: StickyNote }
      : null,
  ].filter(Boolean) as { value: string; label: string; icon: typeof History }[]

  const canViewNotes = can("orders.view_notes")

  return (
    <div className="space-y-5">
      <PageHeader
        title={order.order_number}
        crumbs={[
          { label: "Orders", to: "/orders" },
          { label: order.order_number },
        ]}
        description={`Created ${formatDateTime(order.created_at)} by ${
          order.created_by?.full_name ?? "—"
        }`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/orders">
                <ArrowLeft className="size-4" />
                Orders
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
            {canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <OverallStatusBadge status={order.overall_status} />
        <Badge variant="outline">
          Cutting: {humanize(order.cutting_status)}
        </Badge>
        <Badge variant="outline">
          Operator: {humanize(order.operator_status)}
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              Original order card
            </CardTitle>
            <CardDescription>
              Served through a permission-checked endpoint — never a public URL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuthenticatedImage
              src={order.original_image}
              alt={`Original order card for ${order.order_number}`}
              wrapperClassName="aspect-[4/3] w-full"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              Generated order card
            </CardTitle>
            <CardDescription>
              Regenerated by the server whenever an assignment changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuthenticatedImage
              src={order.generated_image}
              alt={`Generated order card for ${order.order_number}`}
              wrapperClassName="aspect-[4/3] w-full"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assignments &amp; department status</CardTitle>
          <CardDescription>
            Each department advances independently; the overall status is derived
            from both.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["CUTTING", "OPERATOR"] as DepartmentCode[]).map((department) => {
            const person =
              department === "CUTTING" ? order.cutting_man : order.operator
            const status =
              department === "CUTTING" ? order.cutting_status : order.operator_status
            const canActOnDepartment =
              canUpdateStatus &&
              (adminStatusScope || assignedDepartments.includes(department))

            return (
              <div
                key={department}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                    <UserRoundCog className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {department === "CUTTING" ? "Cutting Man" : "Operator"}
                    </p>
                    <PersonCell person={person} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <ProductionStatusBadge status={status} />
                  {canAssign ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAssignDept(department)}
                    >
                      <UserRoundCog className="size-4" />
                      {person ? "Reassign" : "Assign"}
                    </Button>
                  ) : null}
                  {canActOnDepartment && person ? (
                    <Button size="sm" onClick={() => setStatusDept(department)}>
                      Update status
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}

          {!canAssign && statusDepartments.length === 0 ? (
            <Alert>
              <AlertDescription>
                You have read-only access to this order. Status changes and
                reassignment are restricted to the assigned employee and
                administrators.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        {tabs.length > 0 ? (
          <Tabs defaultValue={tabs[0]!.value} className="gap-0">
            <div className="border-b border-border p-4">
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    <tab.icon className="size-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {tabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className="pt-0">
                {tab.value === "assignments" ? (
                  <AssignmentHistoryTable orderId={order.id} />
                ) : null}
                {tab.value === "history" ? (
                  <StatusHistoryTable orderId={order.id} />
                ) : null}
                {tab.value === "notes" ? (
                  <div className="p-4">
                    <NotesPanel orderId={order.id} />
                  </div>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <CardContent className="py-8">
            <Alert>
              <AlertDescription>
                You do not have permission to view assignment history, status
                history or notes for this order.
                {canViewNotes ? "" : " Ask an administrator for read access if you need it."}
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {assignDept ? (
        <AssignDialog
          order={order}
          department={assignDept}
          open
          onOpenChange={(next) => !next && setAssignDept(null)}
        />
      ) : null}

      {statusDept ? (
        <StatusUpdateDialog
          order={order}
          department={statusDept}
          open
          onOpenChange={(next) => !next && setStatusDept(null)}
        />
      ) : null}

      {canEdit ? (
        <EditOrderDialog
          order={order}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
    </div>
  )
}
