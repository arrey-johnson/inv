import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness probe. Public, returns no secrets or business data. */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      supabaseConfigured: isSupabaseConfigured(),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
