import { Progress } from "@/components/ui/misc"
import { cn } from "@/lib/utils"

/**
 * Presentation-only rendering of a backend-computed achievement.
 *
 * `achieved` is the number of completion credits the server attributed to the
 * target; the percentage mirrors the backend's own formula (capped at 100) so the
 * two never disagree in meaning.
 */
export function TargetProgress({
  achieved,
  target,
  className,
}: {
  achieved: number
  target: number
  className?: string
}) {
  const percent =
    target > 0 ? Math.round((Math.min(achieved, target) / target) * 100) : 0
  const reached = target > 0 && achieved >= target

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium tabular">
          {achieved} / {target}
        </span>
        <span
          className={cn(
            "tabular",
            reached ? "font-medium text-status-completed-foreground" : "text-muted-foreground",
          )}
        >
          {percent}%
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={`${achieved} of ${target} completed`}
        className={
          reached ? "[&>[data-slot=progress-indicator]]:bg-status-completed" : undefined
        }
      />
    </div>
  )
}
