// src/pages/api/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type LineItem = { name: string; qty: number };
type IssueLite = {
  status: "open" | "runner_ack" | "client_ack" | "resolved";
  ticket_id: number | null;
  stream: "food" | "drinks" | null;
};

type TicketOut = {
  id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";
  delivered_at: string | null;
  ready_at?: string | null;
  created_at?: string;
  items?: LineItem[];
  has_issue?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const oc = String(req.query.order_code || "");
    if (!oc) return res.status(400).json({ ok: false, error: "order_code required" });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    // 1) Order group (+ table number)
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id, table_number, closed_at, customer_confirmed_at, resolution_required")
      .eq("order_code", oc)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    if (!og) {
      return res.status(200).json({
        ok: true,
        tickets: [],
        closed_at: null,
        customer_confirmed_at: null,
        resolution_required: false,
        issues: [] as IssueLite[],
        runner_ack_ticket_ids: [] as number[],
        table_number: null,
      });
    }

    // 2) Tickets
    const { data: ticketsRaw, error: tErr } = await supa
      .from("tickets")
      .select("id, stream, status, delivered_at, ready_at, created_at")
      .eq("order_group_id", og.id)
      .order("created_at", { ascending: true });
    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    const tIds = (ticketsRaw || []).map((t) => t.id as number);
    const byStream = new Map<"food" | "drinks", number>();
    for (const t of ticketsRaw || []) byStream.set(t.stream as any, t.id as number);

    // 3) Line items
    const { data: itemsRaw, error: liErr } = await supa
      .from("ticket_line_items")
      .select("ticket_id, name, qty")
      .in("ticket_id", tIds.length ? tIds : [-1]);
    if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

    // 4) Issues (include stream)
    const { data: issuesRaw, error: iErr } = await supa
      .from("issues")
      .select("id, ticket_id, status, stream, order_group_id")
      .eq("order_group_id", og.id);
    if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

    // Map items by ticket
    const byTicket = new Map<number, LineItem[]>();
    for (const it of itemsRaw || []) {
      const tid = (it as any).ticket_id as number;
      const arr = byTicket.get(tid) || [];
      arr.push({ name: String((it as any).name), qty: Number((it as any).qty) });
      byTicket.set(tid, arr);
    }

    // Tickets + has_issue
    const tickets: TicketOut[] = (ticketsRaw || []).map((t) => {
      const id = t.id as number;
      const its = byTicket.get(id) || [];
      const has_issue = (issuesRaw || []).some(
        (iss) => (iss as any).ticket_id === id && (iss as any).status !== "resolved"
      );
      return {
        id,
        stream: t.stream as any,
        status: t.status as any,
        delivered_at: (t as any).delivered_at ?? null,
        ready_at: (t as any).ready_at ?? null,
        created_at: (t as any).created_at ?? undefined,
        items: its,
        has_issue,
      };
    });

    // Normalize issues for client
    const issues: IssueLite[] = (issuesRaw || []).map((i) => ({
      status: (i as any).status,
      ticket_id: typeof (i as any).ticket_id === "number" ? (i as any).ticket_id : null,
      stream:
        (i as any).stream === "food" || (i as any).stream === "drinks"
          ? ((i as any).stream as "food" | "drinks")
          : null,
    }));

    // Compute runner-acked ticket ids (covers: direct ticket, by stream, order-wide)
    let runnerAckIds: number[] = [];
    for (const row of issuesRaw || []) {
      if ((row as any).status !== "runner_ack") continue;

      if (typeof (row as any).ticket_id === "number") {
        runnerAckIds.push((row as any).ticket_id as number);
        continue;
      }
      const s = (row as any).stream;
      if (s === "food" || s === "drinks") {
        const tid = byStream.get(s);
        if (tid) runnerAckIds.push(tid);
        continue;
      }
      for (const t of ticketsRaw || []) {
        if (t.status === "delivered" || t.status === "completed") runnerAckIds.push(t.id as number);
      }
    }
    runnerAckIds = Array.from(new Set(runnerAckIds));

    // resolution_required: prefer column, else derive
    const unresolved = (issuesRaw || []).filter((x) => (x as any).status !== "resolved");
    const resolution_required =
      typeof (og as any).resolution_required === "boolean"
        ? Boolean((og as any).resolution_required)
        : unresolved.length > 0;

    return res.status(200).json({
      ok: true,
      tickets,
      closed_at: (og as any).closed_at ?? null,
      customer_confirmed_at: (og as any).customer_confirmed_at ?? null,
      resolution_required,
      issues,
      runner_ack_ticket_ids: runnerAckIds,
      table_number: (og as any).table_number ?? null,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
