// src/pages/api/admin/tables/report.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks" | null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const table = Number(req.query.table);
    if (!Number.isFinite(table) || table <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid table" });
    }

    const days = Math.max(1, Math.min(30, Number(req.query.days ?? 1)));
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 1) Orders (order_groups) for this table in range
    const { data: ogRows, error: ogErr } = await supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, closed_at, resolution_required")
      .eq("table_number", table)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false });

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    const ogIds = (ogRows ?? []).map((r) => Number(r.id));
    let tickets: any[] = [];
    let lines: any[] = [];
    let issues: any[] = [];

    if (ogIds.length) {
      // 2) Tickets
      const { data: tRows, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id, stream, status, created_at, ready_at, delivered_at")
        .in("order_group_id", ogIds);
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      tickets = tRows ?? [];

      // 3) Line items
      const tIds = tickets.map((t) => Number(t.id));
      if (tIds.length) {
        const { data: liRows, error: liErr } = await supa
          .from("ticket_line_items")
          .select("ticket_id, name, qty, unit_price")
          .in("ticket_id", tIds);
        if (liErr) return res.status(500).json({ ok: false, error: liErr.message });
        lines = liRows ?? [];
      }

      // 4) Issues
      const { data: isRows, error: isErr } = await supa
        .from("issues")
        .select("id, order_group_id, ticket_id, stream, type, description, status, created_at, resolved_at")
        .in("order_group_id", ogIds);
      if (isErr) return res.status(500).json({ ok: false, error: isErr.message });
      issues = isRows ?? [];
    }

    // Build nested payload
    const linesByTicket = new Map<number, any[]>();
    for (const li of lines) {
      const tid = Number(li.ticket_id);
      const bucket = linesByTicket.get(tid) ?? [];
      bucket.push({
        ticket_id: tid,
        name: String(li.name),
        qty: Number(li.qty || 0),
        unit_price: Number(li.unit_price || 0),
      });
      linesByTicket.set(tid, bucket);
    }

    const ticketsByOg = new Map<number, any[]>();
    for (const t of tickets) {
      const ogId = Number(t.order_group_id);
      const arr = ticketsByOg.get(ogId) ?? [];
      arr.push({
        id: Number(t.id),
        stream: (t.stream ?? null) as Stream,
        status: String(t.status),
        created_at: t.created_at ?? null,
        ready_at: t.ready_at ?? null,
        delivered_at: t.delivered_at ?? null,
        lines: linesByTicket.get(Number(t.id)) ?? [],
      });
      ticketsByOg.set(ogId, arr);
    }

    const issuesByOg = new Map<number, any[]>();
    for (const i of issues) {
      const ogId = Number(i.order_group_id);
      const arr = issuesByOg.get(ogId) ?? [];
      arr.push({
        id: Number(i.id),
        ticket_id: i.ticket_id ? Number(i.ticket_id) : null,
        stream: (i.stream ?? null) as Stream,
        type: i.type ?? null,
        description: i.description ?? null,
        status: String(i.status),
        created_at: i.created_at ?? null,
        resolved_at: i.resolved_at ?? null,
      });
      issuesByOg.set(ogId, arr);
    }

    // Per-order totals
    const orders = (ogRows ?? []).map((o) => {
      const ogId = Number(o.id);
      const ts = ticketsByOg.get(ogId) ?? [];
      const is = issuesByOg.get(ogId) ?? [];

      let items = 0;
      let revenue = 0;
      for (const t of ts) {
        for (const li of t.lines) {
          const qty = Number(li.qty || 0);
          const unit = Number(li.unit_price || 0);
          items += qty;
          revenue += qty * unit;
        }
      }

      return {
        order_group_id: ogId,
        order_code: String(o.order_code),
        created_at: String(o.created_at),
        closed_at: o.closed_at ?? null,
        resolution_required: !!o.resolution_required,
        totals: { items, revenue },
        tickets: ts,
        issues: is,
      };
    });

    // Grand totals
    const totals = orders.reduce(
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
      totals,
      orders,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
