import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db/runs";
import { isDbConfigured } from "@/lib/db/client";

/** GET /api/runs?limit=50 — recent saved runs, newest first. */
export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Run history is off: DATABASE_URL is not set" }, { status: 503 });
  }
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 100) : 50;
  try {
    return NextResponse.json({ runs: await listRuns(limit) });
  } catch (err) {
    console.error("Failed to list runs", err);
    return NextResponse.json({ error: "Could not read run history" }, { status: 502 });
  }
}
