// src/pages/api/admin/venue-report.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 1)));
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400_000);

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 1) orders in range
    const { data: ogRows, error: ogErr } = await supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, closed_at, resolution_required")
      .gte("created_at", from.toISOString())
      .lte("created_at", now.toISOString())
      .order("created_at", { ascending: true });

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    const ogIds = (ogRows ?? []).map((r: any) => Number(r.id));
    const ordersMap = new Map<number, any>();
    for (const r of ogRows || []) {
      ordersMap.set(Number((r as any).id), {
        order_group_id: Number((r as any).id),
        order_code: String((r as any).order_code),
        table_number: (r as any).table_number ?? null,
        created_at: String((r as any).created_at),
        closed_at: (r as any).closed_at ?? null,
        resolution_required: !!(r as any).resolution_required,
        totals: { items: 0, revenue: 0 },
        tickets: [] as any[],
        issues: [] as any[],
      });
    }

    // 2) tickets
    let ticketIds: number[] = [];
    if (ogIds.length) {
      const { data: tRows, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id, stream, status, created_at, ready_at, delivered_at")
        .in("order_group_id", ogIds)
        .order("created_at", { ascending: true });
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      for (const t of tRows || []) {
        const ogId = Number((t as any).order_group_id);
        const host = ordersMap.get(ogId);
        if (!host) continue;
        host.tickets.push({
          id: Number((t as any).id),
          stream: (t as any).stream ?? null,
          status: String((t as any).status || "received"),
          created_at: (t as any).created_at ?? null,
          ready_at: (t as any).ready_at ?? null,
          delivered_at: (t as any).delivered_at ?? null,
          lines: [] as any[],
        });
        ticketIds.push(Number((t as any).id));
      }
    }

    // 3) line items
    if (ticketIds.length) {
      const { data: liRows, error: liErr } = await supa
        .from("ticket_line_items")
        .select("ticket_id, name, qty, unit_price")
        .in("ticket_id", ticketIds);
      if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

      // map ticket -> parent order
      const ticketToOg = new Map<number, number>();
      for (const [ogId, o] of ordersMap) {
        for (const t of o.tickets) ticketToOg.set(Number(t.id), ogId);
      }

      for (const li of liRows || []) {
        const tid = Number((li as any).ticket_id);
        const ogId = ticketToOg.get(tid);
        if (!ogId) continue;
        const host = ordersMap.get(ogId);
        if (!host) continue;
        const ticket = host.tickets.find((t: any) => Number(t.id) === tid);
        if (!ticket) continue;
        const qty = Number((li as any).qty || 0);
        const unit = Number((li as any).unit_price || 0);
        ticket.lines.push({
          ticket_id: tid,
          name: String((li as any).name),
          qty,
          unit_price: unit,
        });
        host.totals.items += qty;
        host.totals.revenue += qty * unit;
      }
    }

    // 4) issues
    if (ogIds.length) {
      const { data: isRows, error: isErr } = await supa
        .from("issues")
        .select("id, order_group_id, ticket_id, stream, type, description, status, created_at, resolved_at")
        .in("order_group_id", ogIds)
        .order("created_at", { ascending: true });
      if (isErr) return res.status(500).json({ ok: false, error: isErr.message });

      for (const is of isRows || []) {
        const ogId = Number((is as any).order_group_id);
        const host = ordersMap.get(ogId);
        if (!host) continue;
        host.issues.push({
          id: Number((is as any).id),
          ticket_id: (is as any).ticket_id ?? null,
          stream: (is as any).stream ?? null,
          type: (is as any).type ?? null,
          description: (is as any).description ?? null,
          status: String((is as any).status || "open"),
          created_at: String((is as any).created_at),
          resolved_at: (is as any).resolved_at ?? null,
        });
      }
    }

    // Totals + by-table
    let totalOrders = 0;
    let totalItems = 0;
    let totalRevenue = 0;

    const byTableMap = new Map<number, { table_number: number; orders: number; items: number; revenue: number }>();

    const orders = Array.from(ordersMap.values());
    for (const o of orders) {
      totalOrders += 1;
      totalItems += o.totals.items;
      totalRevenue += o.totals.revenue;
      const tbl = Number(o.table_number || 0);
      if (tbl > 0) {
        if (!byTableMap.has(tbl)) byTableMap.set(tbl, { table_number: tbl, orders: 0, items: 0, revenue: 0 });
        const bt = byTableMap.get(tbl)!;
        bt.orders += 1;
        bt.items += o.totals.items;
        bt.revenue += o.totals.revenue;
      }
    }

    const payload = {
      ok: true,
      range: { from: from.toISOString(), to: now.toISOString(), days },
      totals: { orders: totalOrders, items: totalItems, revenue: totalRevenue },
      by_table: Array.from(byTableMap.values()).sort((a, b) => a.table_number - b.table_number),
      orders: orders, // already includes tickets + lines + issues + totals
    };

    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
