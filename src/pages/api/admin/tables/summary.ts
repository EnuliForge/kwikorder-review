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

    // today (server time)
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now);   end.setHours(23, 59, 59, 999);

    // 1) today’s order_groups for these tables
    const { data: ogRows, error: ogErr } = await supa
      .from("order_groups")
      .select("id, table_number, order_code, created_at, closed_at")
      .in("table_number", tables)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    const byTbl = new Map<number, {
      ogIds: number[];
      ordersCount: number;
      currentOpen?: { code: string; created_at: string };
    }>();
    for (const t of tables) byTbl.set(t, { ogIds: [], ordersCount: 0 });

    for (const og of ogRows || []) {
      const tbl = (og as any).table_number as number | null;
      if (!tbl || !byTbl.has(tbl)) continue;
      const b = byTbl.get(tbl)!;
      b.ogIds.push((og as any).id);
      b.ordersCount += 1;
      if ((og as any).closed_at == null) {
        const prev = b.currentOpen;
        if (!prev || new Date((og as any).created_at).getTime() > new Date(prev.created_at).getTime()) {
          b.currentOpen = { code: (og as any).order_code, created_at: (og as any).created_at };
        }
      }
    }

    const allOgIds = Array.from(byTbl.values()).flatMap(v => v.ogIds);

    // 2) tickets -> map ticket -> table
    let tickets: any[] = [];
    if (allOgIds.length) {
      const { data: tRows, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id")
        .in("order_group_id", allOgIds);
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      tickets = tRows || [];
    }
    const ogToTbl = new Map<number, number>();
    for (const [tbl, b] of byTbl.entries()) for (const ogId of b.ogIds) ogToTbl.set(ogId, tbl);

    // 3) line items -> sum qty + revenue per table
    const itemsCountByTbl = new Map<number, number>();
    const revenueByTbl = new Map<number, number>(); // numeric sum (K)

    if (tickets.length) {
      const ticketIds = tickets.map((r: any) => r.id);
      const { data: li, error: liErr } = await supa
        .from("ticket_line_items")
        .select("ticket_id, qty, unit_price")
        .in("ticket_id", ticketIds);
      if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

      const ticketToTbl = new Map<number, number>();
      for (const t of tickets) ticketToTbl.set((t as any).id, ogToTbl.get((t as any).order_group_id)!);

      for (const r of li || []) {
        const tbl = ticketToTbl.get((r as any).ticket_id);
        if (!tbl) continue;
        const qty = Number((r as any).qty || 0);
        const unit = Number((r as any).unit_price || 0);
        itemsCountByTbl.set(tbl, (itemsCountByTbl.get(tbl) || 0) + qty);
        revenueByTbl.set(tbl, (revenueByTbl.get(tbl) || 0) + qty * unit);
      }
    }

    // 4) unresolved issues on today’s orders -> flag per table
    const hasIssueByTbl = new Map<number, boolean>();
    if (allOgIds.length) {
      const { data: iss, error: iErr } = await supa
        .from("issues")
        .select("order_group_id, status")
        .in("order_group_id", allOgIds)
        .neq("status", "resolved");
      if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

      for (const r of iss || []) {
        const tbl = ogToTbl.get((r as any).order_group_id);
        if (!tbl) continue;
        hasIssueByTbl.set(tbl, true);
      }
    }

    const rows = tables.map(tbl => {
      const b = byTbl.get(tbl)!;
      return {
        table_number: tbl,
        orders_count: b.ordersCount,
        items_count: itemsCountByTbl.get(tbl) || 0,
        current_order_code: b.currentOpen?.code || null,
        has_issue: !!hasIssueByTbl.get(tbl),
        revenue: Number(revenueByTbl.get(tbl) || 0), // K value
      };
    });

    return res.status(200).json({ ok: true, rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
