import { ClipboardList, ShieldCheck, Workflow } from "lucide-react"
import * as React from "react"

import { config } from "@/lib/config"

const highlights = [
  {
    icon: ClipboardList,
    title: "Order intake & assignment",
    body: "Capture order cards, assign the cutting and operator teams, and keep the original safe.",
  },
  {
    icon: Workflow,
    title: "Department workflows",
    body: "Each department advances only its own status; overall progress is derived server-side.",
  },
  {
    icon: ShieldCheck,
    title: "Fine-grained access",
    body: "Permissions and data scopes are resolved from the database on every request.",
  },
]

/** Shared frame for every unauthenticated screen. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden on small screens to keep forms above the fold. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 text-slate-100 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
            P
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">{config.appName}</p>
            <p className="text-xs text-slate-400">
              Production Order Management System
            </p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold leading-tight tracking-tight">
              Run production from order card to completion.
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              One workspace for orders, department status, targets and the audit
              trail — backed by the existing POMS business rules.
            </p>
          </div>
          <ul className="space-y-5">
            {highlights.map((item) => (
              <li key={item.title} className="flex gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10">
                  <item.icon className="size-4" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          All access decisions are enforced by the POMS API.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="space-y-1.5 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              P
            </div>
            <p className="pt-2 text-sm font-semibold">{config.appName}</p>
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {children}
          {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </div>
  )
}
