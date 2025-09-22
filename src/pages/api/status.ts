// src/pages/api/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type LineItem = { name: string; qty: number };
type IssueLite = { status: "open" | "runner_ack" | "client_ack" | "resolved" };

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

    // Server-side client (bypass RLS for joined reads)
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
      { auth: { persistSession: false } }
    );

    // 1) Find order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id, closed_at, customer_confirmed_at, resolution_required")
      .eq("order_code", oc)
      .maybeSingle();

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });

    // No such order yet — return empty but OK so page can poll
    if (!og) {
      return res.status(200).json({
        ok: true,
        tickets: [],
        closed_at: null,
        customer_confirmed_at: null,
        resolution_required: false,
        has_runner_ack: false,
        issues: [] as IssueLite[],
      });
    }

    // 2) Tickets for this order
    const { data: ticketsRaw, error: tErr } = await supa
      .from("tickets")
      .select("id, stream, status, delivered_at, ready_at, created_at")
      .eq("order_group_id", og.id)
      .order("created_at", { ascending: true });

    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    const tIds = (ticketsRaw || []).map((t) => t.id as number);

    // 3) Line items (ticket_line_items)
    const { data: itemsRaw, error: liErr } = await supa
      .from("ticket_line_items")
      .select("ticket_id, name, qty")
      .in("ticket_id", tIds.length ? tIds : [-1]);

    if (liErr) return res.status(500).json({ ok: false, error: liErr.message });

    // 4) Issues (for flags + light list)
    const { data: issuesRaw, error: iErr } = await supa
      .from("issues")
      .select("id, ticket_id, status, order_group_id")
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

    // Flags from issues
    const unresolved = (issuesRaw || []).filter((x) => (x as any).status !== "resolved");
    const has_runner_ack = (issuesRaw || []).some((x) => (x as any).status === "runner_ack");

    // Prefer DB column if present; otherwise derive from unresolved
    const resolution_required =
      typeof (og as any).resolution_required === "boolean"
        ? Boolean((og as any).resolution_required)
        : unresolved.length > 0;

    // Shape tickets for the client
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

    // Minimal issue list for the page (optional use)
    const issues: IssueLite[] = (issuesRaw || []).map((i) => ({
      status: (i as any).status,
    }));

    return res.status(200).json({
      ok: true,
      tickets,
      closed_at: (og as any).closed_at ?? null,
      customer_confirmed_at: (og as any).customer_confirmed_at ?? null, // <-- added for delivered-confirm UX
      resolution_required,
      has_runner_ack,
      issues,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
