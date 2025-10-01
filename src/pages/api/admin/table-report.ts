// src/pages/api/admin/table-report.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const tableRaw = req.query.table;
    const table = Number(Array.isArray(tableRaw) ? tableRaw[0] : tableRaw);
    if (!Number.isFinite(table) || table <= 0) {
      return res.status(400).json({ ok: false, error: "table must be a positive number" });
    }

    const daysRaw = req.query.days;
    const days = Math.max(1, Math.min(30, Number(Array.isArray(daysRaw) ? daysRaw[0] : daysRaw) || 1));

    // Inclusive date window: from start-of-day (days-1 days ago) to end-of-today
    const now = new Date();
    const to = new Date(now); to.setHours(23, 59, 59, 999);
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server key
      { auth: { persistSession: false } }
    );

    // 1) order_groups in range
    const { data: ogRows, error: ogErr } = await supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, closed_at, resolution_required")
      .eq("table_number", table)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false });

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    const orders = (ogRows ?? []).map((r: any) => ({
      order_group_id: Number(r.id),
      order_code: String(r.order_code),
      created_at: String(r.created_at),
      closed_at: r.closed_at ?? null,
      resolution_required: !!r.resolution_required,
      totals: { items: 0, revenue: 0 },
      tickets: [] as any[],
      issues: [] as any[],
    }));

    if (orders.length === 0) {
      return res.status(200).json({
        ok: true,
        table,
        range: { from: from.toISOString(), to: to.toISOString(), days },
        totals: { orders: 0, items: 0, revenue: 0 },
        orders: [],
      });
    }

    const ogIds = orders.map((o) => o.order_group_id);

    // 2) tickets for those order_groups
    const { data: tickRows, error: tErr } = await supa
      .from("tickets")
      .select("id, order_group_id, stream, status, created_at, ready_at, delivered_at")
      .in("order_group_id", ogIds);

    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    // 3) lines for those tickets
    const ticketIds = (tickRows ?? []).map((t: any) => Number(t.id));
    let lineRows: any[] = [];
    if (ticketIds.length) {
      const { data: li, error: liErr } = await supa
        .from("ticket_line_items")
        .select("ticket_id, name, qty, unit_price")
        .in("ticket_id", ticketIds);
      if (liErr) return res.status(500).json({ ok: false, error: liErr.message });
      lineRows = li ?? [];
    }

    // 4) issues for those order_groups
    let issueRows: any[] = [];
    {
      const { data: iss, error: iErr } = await supa
        .from("issues")
        .select("id, order_group_id, ticket_id, stream, type, description, status, created_at, resolved_at")
        .in("order_group_id", ogIds)
        .order("created_at", { ascending: true });
      if (iErr) return res.status(500).json({ ok: false, error: iErr.message });
      issueRows = iss ?? [];
    }

    // Index helpers
    const orderByOg = new Map<number, any>();
    orders.forEach((o) => orderByOg.set(o.order_group_id, o));

    const linesByTicket = new Map<number, any[]>();
    for (const r of lineRows) {
      const tid = Number((r as any).ticket_id);
      const arr = linesByTicket.get(tid) ?? [];
      arr.push({
        ticket_id: tid,
        name: String((r as any).name),
        qty: Number((r as any).qty || 0),
        unit_price: Number((r as any).unit_price || 0),
      });
      linesByTicket.set(tid, arr);
    }

    // Attach tickets + compute per-order totals
    for (const tr of tickRows ?? []) {
      const ogId = Number((tr as any).order_group_id);
      const bucket = orderByOg.get(ogId);
      if (!bucket) continue;
      const tid = Number((tr as any).id);
      const lines = linesByTicket.get(tid) ?? [];
      bucket.tickets.push({
        id: tid,
        stream: ((tr as any).stream ?? null) as "food" | "drinks" | null,
        status: String((tr as any).status || "received"),
        created_at: (tr as any).created_at ?? null,
        ready_at: (tr as any).ready_at ?? null,
        delivered_at: (tr as any).delivered_at ?? null,
        lines,
      });
      // tally
      for (const L of lines) {
        bucket.totals.items += Number(L.qty || 0);
        bucket.totals.revenue += Number(L.qty || 0) * Number(L.unit_price || 0);
      }
    }

    // Attach issues
    for (const ir of issueRows) {
      const ogId = Number((ir as any).order_group_id);
      const bucket = orderByOg.get(ogId);
      if (!bucket) continue;
      bucket.issues.push({
        id: Number((ir as any).id),
        ticket_id: (ir as any).ticket_id ? Number((ir as any).ticket_id) : null,
        stream: ((ir as any).stream ?? null) as "food" | "drinks" | null,
        type: (ir as any).type ?? null,
        description: (ir as any).description ?? null,
        status: String((ir as any).status || "open"),
        created_at: String((ir as any).created_at),
        resolved_at: (ir as any).resolved_at ?? null,
      });
    }

    // Grand totals
    const grand = orders.reduce(
      (acc, o) => {
        acc.orders += 1;
        acc.items += o.totals.items;
        acc.revenue += o.totals.revenue;
        return acc;
      },
      { orders: 0, items: 0, revenue: 0 }
    );

    return res.status(200).json({
      ok: true,
      table,
      range: { from: from.toISOString(), to: to.toISOString(), days },
      totals: grand,
      orders,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
