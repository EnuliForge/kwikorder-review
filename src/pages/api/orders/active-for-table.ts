import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { getTableSummaryColorAndLabel, type TableOrderLite } from "@/lib/adminColors";
// If the alias "@/..." fails in pages/api, switch to a relative import:
// import { getTableSummaryColorAndLabel, type TableOrderLite } from "../../../lib/adminColors";

type OgRow = {
  id: number;
  order_code: string;
  table_number: number | null;
  created_at: string;
  resolution_required: boolean;
  closed_at: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const tableRaw = req.query.table;
    const table = Number(Array.isArray(tableRaw) ? tableRaw[0] : tableRaw);
    if (!Number.isFinite(table)) {
      return res.status(400).json({ ok: false, error: "table must be a number" });
    }

    // Optional: how far back to consider “recently closed” for a green table card.
    const lookbackRaw = req.query.lookback_mins;
    const lookbackMins =
      Number(Array.isArray(lookbackRaw) ? lookbackRaw[0] : lookbackRaw) || 120;
    const sinceIso = new Date(Date.now() - Math.max(0, lookbackMins) * 60_000).toISOString();

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    // 1) Active orders
    const activeQ = supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, resolution_required, closed_at")
      .eq("table_number", table)
      .is("closed_at", null)
      .order("created_at", { ascending: false });

    // 2) Recently closed orders (for green state)
    const recentClosedQ = supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, resolution_required, closed_at")
      .eq("table_number", table)
      .not("closed_at", "is", null)
      .gte("closed_at", sinceIso)
      .order("closed_at", { ascending: false });

    const [{ data: activeData, error: activeErr }, { data: rcData, error: rcErr }] =
      await Promise.all([activeQ, recentClosedQ]);

    if (activeErr) return res.status(500).json({ ok: false, error: activeErr.message });
    if (rcErr)     return res.status(500).json({ ok: false, error: rcErr.message });

    const normalize = (rows: any[]): OgRow[] =>
      (rows ?? []).map((o) => ({
        id: Number(o.id),
        order_code: String(o.order_code),
        table_number: (o as any).table_number ?? null,
        created_at: String((o as any).created_at),
        resolution_required: Boolean((o as any).resolution_required),
        closed_at: (o as any).closed_at ?? null,
      }));

    const active = normalize(activeData ?? []);
    const recentClosed = normalize(rcData ?? []);

    // shape for the helpers / UI
    const toLite = (r: OgRow): TableOrderLite => ({
      order_code: r.order_code,
      closed_at: r.closed_at,
      resolution_required: r.resolution_required,
    });

    const activeLite = active.map(toLite);
    const recentClosedLite = recentClosed.map(toLite);

    const { color, label } = getTableSummaryColorAndLabel(activeLite, recentClosedLite);

    // Back-compat: keep "orders" = active orders
    return res.status(200).json({
      ok: true,
      orders: active,                 // existing field (active)
      active_orders: active,          // explicit alias
      recent_closed_orders: recentClosed,
      summary: {
        color,                        // "white" | "orange" | "green" | "red" | "purple"
        label,                        // human label per your spec
        active_count: active.length,
        multiple: active.length >= 2,
        has_issue: active.some(o => o.resolution_required),
        lookback_mins: lookbackMins,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
