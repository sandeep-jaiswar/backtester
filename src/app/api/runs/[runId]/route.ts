import { NextResponse } from "next/server";
import { getRun } from "@/lib/db/runs";
import { isDbConfigured } from "@/lib/db/client";

type Ctx = { params: Promise<{ runId: string }> };

/** GET /api/runs/<runId> — one saved run with its manifest, metrics, trades and equity curve. */
export async function GET(_request: Request, ctx: Ctx) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Run history is off: DATABASE_URL is not set" }, { status: 503 });
  }
  const { runId } = await ctx.params;
  if (!/^[a-f0-9]{16}$/.test(runId)) {
    return NextResponse.json({ error: "Run ids are 16 lowercase hex characters" }, { status: 400 });
  }
  try {
    const run = await getRun(runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    console.error("Failed to read run", runId, err);
    return NextResponse.json({ error: "Could not read run" }, { status: 502 });
  }
}
