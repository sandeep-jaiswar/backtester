import { NextResponse } from "next/server";
import { nseMethods } from "@/lib/nse/methods";

/** Catalog of every ported nselib function, with its parameters. */
export async function GET() {
  return NextResponse.json({
    source: "nselib 2.4.7 (ported to Node)",
    methods: nseMethods.map((m) => ({
      name: m.name,
      module: m.module,
      description: m.description,
      params: m.params,
      url: `/api/nse/${m.name}`,
    })),
  });
}
