import { Suspense } from "react";
import { CompareView } from "@/components/runs/compare-view";

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
      <CompareView />
    </Suspense>
  );
}
