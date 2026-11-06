import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/client";
import {
  deleteCustomStrategy,
  getCustomStrategy,
  isCustomId,
  updateCustomStrategy,
} from "@/lib/db/strategies";
import { strategyBodySchema } from "@/lib/db/strategy-body";

type Ctx = { params: Promise<{ id: string }> };

const OFF = { error: "Strategy storage is off: DATABASE_URL is not set" };

/** GET /api/strategies/<id> */
export async function GET(_request: Request, ctx: Ctx) {
  if (!isDbConfigured()) return NextResponse.json(OFF, { status: 503 });
  const { id } = await ctx.params;
  if (!isCustomId(id)) return NextResponse.json({ error: "Invalid strategy id" }, { status: 400 });
  try {
    const s = await getCustomStrategy(id);
    return s ? NextResponse.json(s) : NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  } catch (err) {
    console.error("Failed to read strategy", id, err);
    return NextResponse.json({ error: "Could not read strategy" }, { status: 502 });
  }
}

/** PUT /api/strategies/<id> — replace name, description and definition. */
export async function PUT(request: Request, ctx: Ctx) {
  if (!isDbConfigured()) return NextResponse.json(OFF, { status: 503 });
  const { id } = await ctx.params;
  if (!isCustomId(id)) return NextResponse.json({ error: "Invalid strategy id" }, { status: 400 });
  const parsed = strategyBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid strategy" }, { status: 400 });
  }
  try {
    const updated = await updateCustomStrategy(id, parsed.data);
    return updated ? NextResponse.json(updated) : NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  } catch (err) {
    console.error("Failed to update strategy", id, err);
    return NextResponse.json({ error: "Could not save the strategy" }, { status: 502 });
  }
}

/** DELETE /api/strategies/<id>. Saved runs keep their manifest, so they stay reproducible from history. */
export async function DELETE(_request: Request, ctx: Ctx) {
  if (!isDbConfigured()) return NextResponse.json(OFF, { status: 503 });
  const { id } = await ctx.params;
  if (!isCustomId(id)) return NextResponse.json({ error: "Invalid strategy id" }, { status: 400 });
  try {
    const removed = await deleteCustomStrategy(id);
    return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  } catch (err) {
    console.error("Failed to delete strategy", id, err);
    return NextResponse.json({ error: "Could not delete strategy" }, { status: 502 });
  }
}
