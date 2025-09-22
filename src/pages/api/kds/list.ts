// src/pages/api/kds/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks";
type Item = { name: string; qty: number };
type TicketOut = {
  id: number;
  status: "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";
  created_at: string | null;
  ready_at: string | null;
  order_code: string;
  table_number: number | null;
  items: Item[];
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const stream = String(req.query.stream || "");
  if (stream !== "food" && stream !== "drinks") {
    return res.status(400).json({ ok: false, error: "stream must be 'food' or 'drinks'" });
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
    { auth: { persistSession: false } }
  );

  // 1) Tickets for this stream in active states
  const { data: tks, error: tErr } = await supa
    .from("tickets")
    .select("id, order_group_id, status, created_at, ready_at")
    .eq("stream", stream as Stream)
    .in("status", ["received", "preparing", "ready"])
    .order("status", { ascending: true })
    .order("created_at", { ascending: true });

  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

  const ticketIds = (tks ?? []).map((t) => (t as any).id as number);
  const ogIds = Array.from(new Set((tks ?? []).map((t) => (t as any).order_group_id as number)));

  // 2) Items per ticket
  const { data: items, error: iErr } = await supa
    .from("ticket_line_items")
    .select("ticket_id, name, qty")
    .in("ticket_id", ticketIds.length ? ticketIds : [-1]);

  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

  // 3) Order groups (table + code)
  const { data: ogs, error: oErr } = await supa
    .from("order_groups")
    .select("id, table_number, order_code")
    .in("id", ogIds.length ? ogIds : [-1]);

  if (oErr) return res.status(500).json({ ok: false, error: oErr.message });

  // Build maps
  const itemsByTicket = new Map<number, Item[]>();
  (items ?? []).forEach((r) => {
    const tid = (r as any).ticket_id as number;
    const arr = itemsByTicket.get(tid) ?? [];
    arr.push({ name: String((r as any).name), qty: Number((r as any).qty) });
    itemsByTicket.set(tid, arr);
  });

  const ogById = new Map<number, { order_code: string; table_number: number | null }>();
  (ogs ?? []).forEach((r) => {
    ogById.set((r as any).id as number, {
      order_code: String((r as any).order_code),
      table_number: (r as any).table_number ?? null,
    });
  });

  // Shape response
  const out: TicketOut[] = (tks ?? []).map((t) => {
    const og = ogById.get((t as any).order_group_id as number);
    return {
      id: (t as any).id as number,
      status: (t as any).status,
      created_at: (t as any).created_at ?? null,
      ready_at: (t as any).ready_at ?? null,
      order_code: og?.order_code ?? "?",
      table_number: og?.table_number ?? null,
      items: itemsByTicket.get((t as any).id as number) ?? [],
    };
  });

  return res.status(200).json({ ok: true, tickets: out });
}

export default handler;
