import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/client";
import { createCustomStrategy, listCustomStrategies } from "@/lib/db/strategies";
import { strategyBodySchema } from "@/lib/db/strategy-body";

const OFF = { error: "Strategy storage is off: DATABASE_URL is not set" };

/** GET /api/strategies — saved custom strategies, most recently changed first. */
export async function GET() {
  if (!isDbConfigured()) return NextResponse.json(OFF, { status: 503 });
  try {
    return NextResponse.json({ strategies: await listCustomStrategies() });
  } catch (err) {
    console.error("Failed to list strategies", err);
    return NextResponse.json({ error: "Could not read strategies" }, { status: 502 });
  }
}

/** POST /api/strategies — create a custom strategy. The server assigns the id. */
export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json(OFF, { status: 503 });
  const parsed = strategyBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid strategy" }, { status: 400 });
  }
  try {
    const created = await createCustomStrategy(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Failed to create strategy", err);
    return NextResponse.json({ error: "Could not save the strategy" }, { status: 502 });
  }
}
