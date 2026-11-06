import { NextResponse } from "next/server";
import { getNseMethod, nseMethods } from "@/lib/nse/methods";
import { parseParams } from "@/lib/nse/methods/types";
import { NseError } from "@/lib/nse/core/http";

type Ctx = { params: Promise<{ method: string }> };

/**
 * GET /api/nse/<nselib function name>?param=value
 * Example: /api/nse/bhav_copy_equities?trade_date=20-06-2023
 */
export async function GET(request: Request, ctx: Ctx) {
  const { method } = await ctx.params;
  const def = getNseMethod(method);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown method '${method}'`, available: nseMethods.map((m) => m.name) },
      { status: 404 },
    );
  }

  try {
    const args = parseParams(def, new URL(request.url).searchParams);
    const data = await def.run(args);
    return NextResponse.json({ method: def.name, module: def.module, data });
  } catch (err) {
    if (err instanceof NseError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: `NSE request failed: ${message}` }, { status: 502 });
  }
}
