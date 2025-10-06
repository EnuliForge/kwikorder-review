// src/pages/api/admin/table/summary.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const maxTables = Math.max(1, Math.min(100, parseInt(String(req.query.max ?? "10"), 10) || 10));
  const tables = Array.from({ length: maxTables }, (_, i) => i + 1);

  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // === Time window for "today" stats (local server time)
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now);   end.setHours(23, 59, 59, 999);

    // ------------------------------------------------------------
    // 1) Today's orders (for items_count/revenue "today" KPIs)
    // ------------------------------------------------------------
    const { data: ogToday, error: ogTodayErr } = await supa
      .from("order_groups")
      .select("id, table_number, order_code, created_at, closed_at")
      .in("table_number", tables)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());

    if (ogTodayErr) return res.status(500).json({ ok: false, error: ogTodayErr.message });

    type Bucket = {
      ogTodayIds: number[];
      ordersCountToday: number;
      // we'll fill these after we fetch active rows
      activeOrderCodes: string[];
      activeOgIds: number[];
      currentOpen?: { code: string; created_at: string };
    };

    const byTbl = new Map<number, Bucket>();
    for (const t of tables) {
      byTbl.set(t, {
        ogTodayIds: [],
        ordersCountToday: 0,
        activeOrderCodes: [],
        activeOgIds: [],
      });
    }

    for (const og of ogToday || []) {
      const tbl = (og as any).table_number as number | null;
      if (!tbl || !byTbl.has(tbl)) continue;
      const b = byTbl.get(tbl)!;
      b.ogTodayIds.push((og as any).id);
      b.ordersCountToday += 1;
    }

    // ------------------------------------------------------------
    // 2) Active (open) orders — NO date filter (for multi-open support)
    // ------------------------------------------------------------
    const { data: ogActive, error: ogActiveErr } = await supa
      .from("order_groups")
      .select("id, table_number, order_code, created_at")
      .in("table_number", tables)
      .is("closed_at", null)
      .order("created_at", { ascending: false });

    if (ogActiveErr) return res.status(500).json({ ok: false, error: ogActiveErr.message });

    for (const og of ogActive || []) {
      const tbl = (og as any).table_number as number | null;
      if (!tbl || !byTbl.has(tbl)) continue;
      const b = byTbl.get(tbl)!;
      b.activeOgIds.push((og as any).id);
      b.activeOrderCodes.push(String((og as any).order_code));

      // Track most-recent open order as "current_open" (back-compat)
      const prev = b.currentOpen;
      const thisTime = new Date((og as any).created_at).getTime();
      if (!prev || thisTime > new Date(prev.created_at).getTime()) {
        b.currentOpen = { code: (og as any).order_code, created_at: (og as any).created_at };
      }
    }

    // Convenience maps
    const allOgTodayIds = Array.from(byTbl.values()).flatMap(v => v.ogTodayIds);
    const allOgActiveIds = Array.from(byTbl.values()).flatMap(v => v.activeOgIds);

    // ------------------------------------------------------------
    // 3) tickets -> map ticket -> table (for today's KPIs)
    // ------------------------------------------------------------
    let ticketsToday: any[] = [];
    if (allOgTodayIds.length) {
      const { data: tRows, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id")
        .in("order_group_id", allOgTodayIds);
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      ticketsToday = tRows || [];
    }

    const ogTodayToTbl = new Map<number, number>();
    for (const [tbl, b] of byTbl.entries()) {
      for (const ogId of b.ogTodayIds) ogTodayToTbl.set(ogId, tbl);
    }

    // 3b) line items -> sum qty + revenue per table (today only)
    const itemsCountByTbl = new Map<number, number>();
    const revenueByTbl = new Map<number, number>(); // numeric sum (K)

    if (ticketsToday.length) {
      const ticketIds = ticketsToday.map((r: any) => r.id);
      const { data: li, error: liErr } = await supa
        .from("ticket_line_items")
        .select("ticket_id, qty, unit_price")
        .in("ticket_id", ticketIds);
      if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

      const ticketToTbl = new Map<number, number>();
      for (const t of ticketsToday) {
        ticketToTbl.set((t as any).id, ogTodayToTbl.get((t as any).order_group_id)!);
      }

      for (const r of li || []) {
        const tbl = ticketToTbl.get((r as any).ticket_id);
        if (!tbl) continue;
        const qty = Number((r as any).qty || 0);
        const unit = Number((r as any).unit_price || 0);
        itemsCountByTbl.set(tbl, (itemsCountByTbl.get(tbl) || 0) + qty);
        revenueByTbl.set(tbl, (revenueByTbl.get(tbl) || 0) + qty * unit);
      }
    }

    // ------------------------------------------------------------
    // 4) unresolved issues -> flag per table (check ACTIVE orders)
    // ------------------------------------------------------------
    const hasIssueByTbl = new Map<number, boolean>();
    if (allOgActiveIds.length) {
      const { data: iss, error: iErr } = await supa
        .from("issues")
        .select("order_group_id, status")
        .in("order_group_id", allOgActiveIds)
        .neq("status", "resolved");
      if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

      // Build a quick lookup: active og id -> table
      const ogActiveToTbl = new Map<number, number>();
      for (const [tbl, b] of byTbl.entries()) {
        for (const ogId of b.activeOgIds) ogActiveToTbl.set(ogId, tbl);
      }

      for (const r of iss || []) {
        const tbl = ogActiveToTbl.get((r as any).order_group_id);
        if (!tbl) continue;
        hasIssueByTbl.set(tbl, true);
      }
    }

    // ------------------------------------------------------------
    // 5) Final rows
    // ------------------------------------------------------------
    const rows = tables.map(tbl => {
      const b = byTbl.get(tbl)!;
      const activeCount = b.activeOrderCodes.length;

      return {
        table_number: tbl,

        // Active/open orders (no date filter)
        active_count: activeCount,
        active_order_codes: b.activeOrderCodes,     // NEW
        current_order_code: b.currentOpen?.code || null, // kept for back-compat
        has_issue: !!hasIssueByTbl.get(tbl),

        // Today's stats
        orders_count_today: b.ordersCountToday,
        items_count_today: itemsCountByTbl.get(tbl) || 0,
        revenue_today: Number(revenueByTbl.get(tbl) || 0), // K value

        // Handy link for printing (you built this page)
        report_url: `/admin/tables/${tbl}/report?days=1`,
      };
    });

    return res.status(200).json({ ok: true, rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
