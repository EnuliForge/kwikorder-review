// src/pages/api/orders/active-for-table.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { getTableSummaryColorAndLabel, type TableOrderLite } from "@/lib/adminColors";
import { getInt } from "@/lib/http/params"; // ← use this to normalize query params

/* ----------------------------- Types ----------------------------- */
type OgRow = {
  id: number;
  order_code: string | null;
  table_number: number | null;
  created_at: string;                 // ISO string
  resolution_required: boolean | null;
  closed_at: string | null;
};

type Summary = {
  color: "white" | "orange" | "green" | "red" | "purple";
  label: string;
  active_count: number;
  multiple: boolean;
  has_issue: boolean;
  lookback_mins: number;
};

type Ok = {
  ok: true;
  orders: OgRow[];                    // kept for back-compat (active only)
  active_orders: OgRow[];
  recent_closed_orders: OgRow[];
  summary: Summary;
};
type Err = { ok: false; error: string };
type Resp = Ok | Err;

/* ---------------------------- Handler ---------------------------- */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>
) {
  try {
    // 1) Method guard
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    // 2) Parse & validate inputs (using helpers)
    const table = getInt(req.query.table, { min: 1 });
    if (table == null) {
      return res.status(400).json({ ok: false, error: "table must be a number" });
    }

    // cap lookback to something reasonable (e.g., 0..1440 minutes = 24h)
    const lookbackMins = getInt(req.query.lookback_mins, { min: 0, max: 1440 }) ?? 120;
    const sinceIso = new Date(Date.now() - lookbackMins * 60_000).toISOString();

    // 3) Supabase (server-side credentials)
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    // 4) Queries
    const activeQ = supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, resolution_required, closed_at")
      .eq("table_number", table)
      .is("closed_at", null)
      .order("created_at", { ascending: false });

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

    // 5) Normalize → strongly typed
    const norm = (rows: unknown[]): OgRow[] =>
      (rows ?? []).map((r) => {
        const o = r as Partial<OgRow> & Record<string, unknown>;
        return {
          id: Number(o.id),
          order_code: o.order_code == null ? null : String(o.order_code),
          table_number: o.table_number == null ? null : Number(o.table_number),
          created_at: String(o.created_at),
          resolution_required: o.resolution_required == null ? null : Boolean(o.resolution_required),
          closed_at: o.closed_at == null ? null : String(o.closed_at),
        };
      });

    const active = norm(activeData ?? []);
    const recentClosed = norm(rcData ?? []);

    // 6) Summary color/label for the admin grid
    const toLite = (r: OgRow): TableOrderLite => ({
      order_code: r.order_code ?? "",
      closed_at: r.closed_at,
      resolution_required: Boolean(r.resolution_required),
    });

    const { color, label } = getTableSummaryColorAndLabel(
      active.map(toLite),
      recentClosed.map(toLite)
    );

    // (optional) Cache hint
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      ok: true,
      orders: active,                 // back-compat
      active_orders: active,
      recent_closed_orders: recentClosed,
      summary: {
        color,
        label,
        active_count: active.length,
        multiple: active.length >= 2,
        has_issue: active.some((o) => Boolean(o.resolution_required)),
        lookback_mins: lookbackMins,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: msg });
  }
}
