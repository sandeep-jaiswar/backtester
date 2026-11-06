import { Suspense } from "react";
import { RunDetail } from "@/components/runs/run-detail";

async function RunContent({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetail runId={runId} />;
}

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <Suspense fallback={null}>
      <RunContent params={params} />
    </Suspense>
  );
}
