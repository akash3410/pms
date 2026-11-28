import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, ImagePlus, Loader2, UploadCloud, X } from "lucide-react"
import * as React from "react"
import { Controller, useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

import { ErrorState } from "@/components/feedback/states"
import { PageHeader } from "@/components/layout/page-header"
import { FormField, FormGrid } from "@/components/shared/form-field"
import { Alert, AlertDescription } from "@/components/ui/misc"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAssigneeOptions, useCreateOrder } from "@/features/orders/hooks"
import { normalizeError } from "@/lib/api/errors"

/** Mirrors the backend's order-number contract (`apps/orders/serializers.py`). */
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

const schema = z.object({
  order_number: z
    .string()
    .trim()
    .min(1, "Order number is required.")
    .max(64, "Order number must be at most 64 characters.")
    .regex(
      ORDER_NUMBER_PATTERN,
      "Use letters, digits, spaces, hyphens or underscores, starting with a letter or digit.",
    ),
  cutting_man: z.string().uuid("Select a Cutting Man."),
  operator: z.string().uuid("Select an Operator."),
})

type FormValues = z.infer<typeof schema>

export function OrderCreatePage() {
  const navigate = useNavigate()
  const createOrder = useCreateOrder()
  const [file, setFile] = React.useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const inputRef = React.useRef<HTMLInputElement>(null)

  const cuttingOptions = useAssigneeOptions("CUTTING")
  const operatorOptions = useAssigneeOptions("OPERATOR")

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { order_number: "", cutting_man: "", operator: "" },
  })

  // Object URLs must be revoked to avoid leaking memory between selections.
  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const selectFile = (candidate: File | null) => {
    setFileError(null)
    if (!candidate) {
      setFile(null)
      return
    }
    if (!ACCEPTED_TYPES.includes(candidate.type)) {
      setFileError("Choose a JPG, PNG or WebP image.")
      return
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      setFileError("The image must be 10 MB or smaller.")
      return
    }
    setFile(candidate)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setFieldErrors({})
    if (!file) {
      setFileError("Upload the original order-card image.")
      return
    }
    try {
      const order = await createOrder.mutateAsync({
        order_number: values.order_number,
        original_image: file,
        cutting_man: values.cutting_man,
        operator: values.operator,
      })
      toast.success(`Order ${order.order_number} created.`)
      navigate(`/orders/${order.id}`, { replace: true })
    } catch (error) {
      const apiError = normalizeError(error)
      setFormError(apiError.detail)
      setFieldErrors(apiError.fieldErrors)
    }
  })

  const cuttingEmpty =
    !cuttingOptions.isPending &&
    !cuttingOptions.isError &&
    (cuttingOptions.data?.length ?? 0) === 0
  const operatorEmpty =
    !operatorOptions.isPending &&
    !operatorOptions.isError &&
    (operatorOptions.data?.length ?? 0) === 0

  const optionsUnavailable = cuttingOptions.isError || operatorOptions.isError

  return (
    <div className="space-y-5">
      <PageHeader
        title="New order"
        description="Upload the original order card and assign one Cutting Man and one Operator. The generated card and all status fields are produced by the server."
        crumbs={[{ label: "Orders", to: "/orders" }, { label: "New" }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/orders">Cancel</Link>
          </Button>
        }
      />

      {optionsUnavailable ? (
        <ErrorState
          error={cuttingOptions.error ?? operatorOptions.error}
          title="Could not load employees for assignment"
          onRetry={() => {
            void cuttingOptions.refetch()
            void operatorOptions.refetch()
          }}
        />
      ) : null}

      <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[1.4fr_1fr]" noValidate>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Order details</CardTitle>
              <CardDescription>
                The order number is the business identifier and must be unique.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {formError ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <FormField
                id="order_number"
                label="Order number"
                required
                error={
                  form.formState.errors.order_number?.message ??
                  fieldErrors.order_number?.join(" ")
                }
              >
                <input
                  id="order_number"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive"
                  placeholder="e.g. ORD-2026-0001"
                  aria-invalid={Boolean(form.formState.errors.order_number)}
                  {...form.register("order_number")}
                />
              </FormField>

              <FormGrid>
                <FormField
                  id="cutting_man"
                  label="Cutting Man"
                  required
                  error={
                    form.formState.errors.cutting_man?.message ??
                    fieldErrors.cutting_man?.join(" ")
                  }
                  description="Only active employees with the Cutting Man role are eligible."
                >
                  <Controller
                    control={form.control}
                    name="cutting_man"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={cuttingOptions.isPending}
                      >
                        <SelectTrigger id="cutting_man" aria-invalid={Boolean(form.formState.errors.cutting_man)}>
                          <SelectValue
                            placeholder={
                              cuttingOptions.isPending
                                ? "Loading employees…"
                                : cuttingEmpty
                                  ? "No eligible employees"
                                  : "Select a Cutting Man"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(cuttingOptions.data ?? []).map((employee) => (
                            <SelectItem key={employee.id} value={employee.id}>
                              {employee.full_name} · {employee.employee_code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>

                <FormField
                  id="operator"
                  label="Operator"
                  required
                  error={
                    form.formState.errors.operator?.message ??
                    fieldErrors.operator?.join(" ")
                  }
                  description="Only active employees with the Operator role are eligible."
                >
                  <Controller
                    control={form.control}
                    name="operator"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={operatorOptions.isPending}
                      >
                        <SelectTrigger id="operator" aria-invalid={Boolean(form.formState.errors.operator)}>
                          <SelectValue
                            placeholder={
                              operatorOptions.isPending
                                ? "Loading employees…"
                                : operatorEmpty
                                  ? "No eligible employees"
                                  : "Select an Operator"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(operatorOptions.data ?? []).map((employee) => (
                            <SelectItem key={employee.id} value={employee.id}>
                              {employee.full_name} · {employee.employee_code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              </FormGrid>

              {cuttingEmpty || operatorEmpty ? (
                <Alert variant="warning">
                  <AlertCircle />
                  <AlertDescription>
                    {cuttingEmpty && operatorEmpty
                      ? "No eligible Cutting Man or Operator accounts exist yet."
                      : cuttingEmpty
                        ? "No active employees hold the Cutting Man role."
                        : "No active employees hold the Operator role."}{" "}
                    Create the employee and assign the matching RBAC role first.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Original order card</CardTitle>
              <CardDescription>
                JPG, PNG or WebP up to 10 MB. The server stores this untouched and
                generates a separate card with the assignee names.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  selectFile(event.dataTransfer.files[0] ?? null)
                }}
                className="rounded-lg border border-dashed border-border bg-muted/30 p-6"
              >
                {previewUrl ? (
                  <div className="space-y-3">
                    <img
                      src={previewUrl}
                      alt="Selected order card preview"
                      className="mx-auto max-h-72 rounded-md border border-border object-contain"
                    />
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{file?.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFile(null)
                          if (inputRef.current) inputRef.current.value = ""
                        }}
                      >
                        <X className="size-3.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <UploadCloud className="size-7 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium">Drop the order card here</p>
                    <p className="text-xs text-muted-foreground">
                      or choose a file from your device
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => inputRef.current?.click()}
                    >
                      <ImagePlus className="size-4" />
                      Choose image
                    </Button>
                  </div>
                )}

                <div className="mt-3">
                  <Label htmlFor="original_image" className="sr-only">
                    Original order image
                  </Label>
                  <input
                    ref={inputRef}
                    id="original_image"
                    type="file"
                    accept={ACCEPTED_TYPES.join(",")}
                    className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground"
                    onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              {fileError || fieldErrors.original_image ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {fileError ?? fieldErrors.original_image?.join(" ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>What happens next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="list-disc space-y-2 pl-4">
              <li>Both departments start as Pending and the overall status is Pending.</li>
              <li>
                An order-card image with the assignee names is generated from the
                original — the original is never modified.
              </li>
              <li>
                Two immutable assignment-history records are written for the initial
                assignment.
              </li>
              <li>
                Reassigning later preserves completion credit with the employee who
                did the work.
              </li>
            </ul>
            <Button type="submit" className="w-full" disabled={createOrder.isPending}>
              {createOrder.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating order…
                </>
              ) : (
                "Create order"
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
