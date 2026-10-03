import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Page title block with an optional actions slot (buttons). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Honest placeholder for modules scheduled for a later phase. */
export function PhasePlaceholder({
  phase,
  title,
  bullets,
}: {
  phase: string;
  title: string;
  bullets: string[];
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-4 py-10 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Construction className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <p className="font-medium">
            {title} <span className="text-sm font-normal text-muted-foreground">- planned for {phase}</span>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
