"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { numberProblem, type NumberRules } from "@/lib/number-rules";
import { cn } from "@/lib/utils";

interface Props extends NumberRules {
  id?: string;
  label: string;
  /** NaN when the field is blank. Never coerced to 0. */
  value: number;
  onChange: (value: number) => void;
  step?: number;
  className?: string;
}

/** Labelled number input. Blank stays blank, and an out-of-range value gets an inline message. */
export function NumberField({ id, label, value, onChange, min, max, step, integer, optional, className }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const problem = numberProblem(value, { min, max, integer, optional });

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={inputId}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      {problem ? (
        <p id={errorId} className="text-xs text-negative">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
