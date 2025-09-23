// src/pages/api/admin/tables/items.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type RowItem = {
  ticket_id: number;
  name: string | null;
  qty: number | null;
  unit_price: number | null;
};

type TicketRow = {
  id: number;
  order_group_id: number;
  stream: "food" | "drinks" | null;
};

type OGRow = {
  id: number;
  order_code: string;
  created_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const table = parseInt(String(req.query.table ?? ""), 10);
  if (!Number.isFinite(table) || table <= 0) {
    return res.status(400).json({ ok: false, error: "Valid ?table= required" });
  }

  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server key for joined reads
      { auth: { persistSession: false } }
    );

    // Today window (server time)
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now);   end.setHours(23, 59, 59, 999);

    // 1) Orders for this table today
    const { data: ogRows, error: ogErr } = await supa
      .from("order_groups")
      .select("id, order_code, created_at")
      .eq("table_number", table)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: false });

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    const ogs: OGRow[] = (ogRows || []) as any[];
    if (ogs.length === 0) {
      return res.status(200).json({ ok: true, rows: [] });
    }

    const ogIds = ogs.map((r) => r.id);
    const ogMeta = new Map<number, { code: string; created_at: string }>();
    ogs.forEach((r) => ogMeta.set(r.id, { code: r.order_code, created_at: r.created_at }));

    // 2) Tickets for those orders (to map stream + og)
    const { data: tRows, error: tErr } = await supa
      .from("tickets")
      .select("id, order_group_id, stream")
      .in("order_group_id", ogIds);

    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    const tickets: TicketRow[] = (tRows || []) as any[];
    if (tickets.length === 0) {
      return res.status(200).json({ ok: true, rows: [] });
    }

    const ticketTo = new Map<number, { og_id: number; stream: "food" | "drinks" | null }>();
    tickets.forEach((t) => ticketTo.set(t.id, { og_id: t.order_group_id, stream: t.stream }));

    // 3) Items on those tickets
    const ticketIds = tickets.map((t) => t.id);
    const { data: liRows, error: liErr } = await supa
      .from("ticket_line_items")
      .select("ticket_id, name, qty, unit_price")
      .in("ticket_id", ticketIds);

    if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

    const items: RowItem[] = (liRows || []) as any[];

    // 4) Group by order_code
    type OrderBlock = {
      order_code: string;
      created_at: string;
      total: number;
      items: { name: string; stream: "food" | "drinks" | null; qty: number; line_total: number }[];
    };

    const byCode = new Map<string, OrderBlock>();

    for (const r of items) {
      const tMeta = r.ticket_id ? ticketTo.get(r.ticket_id) : undefined;
      if (!tMeta) continue;

      const meta = ogMeta.get(tMeta.og_id);
      if (!meta) continue;

      const code = meta.code;
      const block =
        byCode.get(code) ||
        { order_code: code, created_at: meta.created_at, total: 0, items: [] };

      const qty = Number(r.qty || 0);
      const price = Number(r.unit_price || 0);
      const line_total = qty * price;

      block.items.push({
        name: String(r.name || "Item"),
        stream: tMeta.stream ?? null,
        qty,
        line_total,
      });
      block.total += line_total;

      byCode.set(code, block);
    }

    // Sort newest order first; items with food first, then drinks
    const rows = Array.from(byCode.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((r) => ({
        ...r,
        items: r.items.sort((a, b) =>
          a.stream === b.stream ? 0 : a.stream === "food" ? -1 : 1
        ),
      }));

    return res.status(200).json({ ok: true, rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
