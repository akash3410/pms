/**
 * Renders an order image served by a permission-checked endpoint.
 *
 * The backend deliberately does not expose `/media/` publicly: images are
 * streamed from `orders/{id}/original-image|generated-image/` with the caller's
 * token. A plain `<img src>` cannot send that header, so the blob is fetched with
 * the authenticated client and rendered from an object URL.
 */
import { ImageOff, Loader2 } from "lucide-react"
import * as React from "react"

import { getObjectUrl } from "@/lib/api/client"
import { cn } from "@/lib/utils"

interface AuthenticatedImageProps {
  /** API path returned by the serializer (e.g. `/api/v1/orders/{id}/original-image/`). */
  src: string | null | undefined
  alt: string
  className?: string
  /** Wrapper class (sizing + border live here). */
  wrapperClassName?: string
}

export function AuthenticatedImage({
  src,
  alt,
  className,
  wrapperClassName,
}: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null)
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  )

  React.useEffect(() => {
    if (!src) {
      setObjectUrl(null)
      setState("idle")
      return
    }

    let cancelled = false
    let createdUrl: string | null = null
    setState("loading")

    getObjectUrl(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        createdUrl = url
        setObjectUrl(url)
        setState("ready")
      })
      .catch(() => {
        if (!cancelled) setState("error")
      })

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
      setObjectUrl(null)
    }
  }, [src])

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40",
        wrapperClassName,
      )}
    >
      {state === "loading" ? (
        <Loader2
          className="size-5 animate-spin text-muted-foreground"
          aria-label="Loading image"
        />
      ) : null}

      {state === "ready" && objectUrl ? (
        <img
          src={objectUrl}
          alt={alt}
          className={cn("h-full w-full object-contain", className)}
        />
      ) : null}

      {state === "error" ? (
        <div className="flex flex-col items-center gap-1 p-4 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          <span>Image unavailable</span>
        </div>
      ) : null}

      {state === "idle" ? (
        <div className="flex flex-col items-center gap-1 p-4 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          <span>No image</span>
        </div>
      ) : null}
    </div>
  )
}
