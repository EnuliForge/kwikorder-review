// src/pages/api/orders/by-code.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks";
type TicketStatus = "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const raw = req.query.code;
    const code = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (!code) return res.status(400).json({ ok: false, error: "Missing ?code" });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    // 1) Order group by code
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("*")
      .eq("order_code", code)
      .single();

    if (ogErr) return res.status(404).json({ ok: false, error: ogErr.message || "Order not found" });
    if (!og)   return res.status(404).json({ ok: false, error: "Order not found" });

    const ogId = Number(og.id);

    // 2) Tickets + line items
    const { data: tix, error: tErr } = await supa
      .from("tickets")
      .select("id, stream, status, delivered_at, ready_at, created_at")
      .eq("order_group_id", ogId)
      .order("id", { ascending: true });

    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    // Fetch line items for all tickets (single round-trip)
    const ticketIds = (tix ?? []).map((t) => Number(t.id));
    let itemsByTicket = new Map<number, { name: string; qty: number }[]>();
    if (ticketIds.length > 0) {
      const { data: li, error: liErr } = await supa
        .from("ticket_line_items")
        .select("ticket_id, name, qty")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true });

      if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

      for (const row of li ?? []) {
        const tid = Number(row.ticket_id);
        const arr = itemsByTicket.get(tid) ?? [];
        arr.push({ name: String(row.name), qty: Number(row.qty ?? 1) });
        itemsByTicket.set(tid, arr);
      }
    }

    // 3) Issues on this order
    const { data: issues, error: iErr } = await supa
      .from("issues")
      .select("status, ticket_id, stream")
      .eq("order_group_id", ogId)
      .order("created_at", { ascending: true });

    if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

    // helper: runner_ack tickets (for the client-ack prompt)
    const runnerAckTicketIds: number[] = Array.from(
      new Set(
        (issues ?? [])
          .filter((i: any) => i.status === "runner_ack" && i.ticket_id != null)
          .map((i: any) => Number(i.ticket_id))
      )
    );

    // helper: per-ticket has_issue flag (any non-resolved)
    const hasIssueByTicket = new Map<number, boolean>();
    for (const i of issues ?? []) {
      const tid = (i as any).ticket_id;
      if (tid != null && (i as any).status !== "resolved") {
        hasIssueByTicket.set(Number(tid), true);
      }
    }

    const normalizedTickets = (tix ?? []).map((t) => ({
      id: Number(t.id),
      stream: (t.stream as Stream) ?? null,
      status: (t.status as TicketStatus),
      delivered_at: t.delivered_at ?? null,
      ready_at: t.ready_at ?? null,
      created_at: t.created_at ?? null,
      items: itemsByTicket.get(Number(t.id)) ?? [],
      has_issue: !!hasIssueByTicket.get(Number(t.id)),
    }));

    return res.status(200).json({
      ok: true,
      order_code: code,
      table_number: (og as any).table_number ?? null,
      closed_at: (og as any).closed_at ?? null,
      customer_confirmed_at: (og as any).customer_confirmed_at ?? null,
      resolution_required: !!(og as any).resolution_required,
      tickets: normalizedTickets,
      issues: (issues ?? []).map((i: any) => ({
        status: i.status,
        ticket_id: i.ticket_id == null ? null : Number(i.ticket_id),
        stream: i.stream ?? null,
      })),
      runner_ack_ticket_ids: runnerAckTicketIds,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
