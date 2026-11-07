import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** A metric name with its definition on hover. Focusable, so keyboard users can reach it too. */
export function Term({ id, children }: { id: GlossaryKey; children?: ReactNode }) {
  const entry = GLOSSARY[id];
  return (
    <abbr
      title={entry.definition}
      tabIndex={0}
      className="cursor-help no-underline decoration-dotted underline underline-offset-2"
    >
      {children ?? entry.label}
    </abbr>
  );
}
