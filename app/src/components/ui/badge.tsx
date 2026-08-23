import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]",
        success:
          "bg-[var(--color-success)]/10 text-[var(--color-success)]",
        warning:
          "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
        danger: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
        info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
        accent: "bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
