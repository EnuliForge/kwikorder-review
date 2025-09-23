// src/pages/api/runner/queue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks";
type TicketStatus = "ready" | "received" | "preparing" | "cancelled" | "delivered" | "completed";

type DeliverRow = {
  kind: "deliver";
  ticket_id: number;
  issue_id: null;
  order_code: string;
  table_number: number | null;
  stream: Stream;
  status: TicketStatus;
  ready_at: string | null;
  created_at: string | null;
};

type IssueRow = {
  kind: "issue";
  ticket_id: number | null;            // we try to resolve a ticket; can be null
  issue_id: number;
  order_code: string;
  table_number: number | null;
  stream: Stream | null;               // issue can be order-wide (null)
  status: null;
  ready_at: null;
  issue_type: string | null;
  issue_status: "open" | "runner_ack" | "client_ack" | "resolved";
  created_at: string | null;           // issue created_at
};

type Row = DeliverRow | IssueRow;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 1) Ready tickets (from view)
    const { data: ready, error: rqErr } = await supa
      .from("runner_queue")
      .select("ticket_id, order_code, table_number, stream, status, ready_at");
    if (rqErr) return res.status(500).json({ ok: false, error: rqErr.message });

    const deliverRows: DeliverRow[] = (ready ?? []).map((r: any) => ({
      kind: "deliver",
      ticket_id: r.ticket_id,
      issue_id: null,
      order_code: String(r.order_code),
      table_number: r.table_number ?? null,
      stream: r.stream,
      status: r.status,
      ready_at: r.ready_at ?? null,
      created_at: null,
    }));

    // 2) Open issues (runner needs to act on these)
    const { data: issues, error: iErr } = await supa
      .from("issues")
      .select("id, order_group_id, ticket_id, stream, type, status, created_at")
      .eq("status", "open");
    if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

    const ogIds = Array.from(new Set((issues ?? []).map((i: any) => i.order_group_id))).filter(Boolean);
    let ogMap = new Map<number, { order_code: string; table_number: number | null }>();
    if (ogIds.length) {
      const { data: ogs, error: ogErr } = await supa
        .from("order_groups")
        .select("id, order_code, table_number")
        .in("id", ogIds);
      if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
      for (const og of ogs ?? []) {
        ogMap.set(og.id as number, {
          order_code: String(og.order_code),
          table_number: (og as any).table_number ?? null,
        });
      }
    }

    // For issues missing ticket_id, try to resolve a ticket_id by stream (best effort)
    let tixByOg: Map<number, Array<{ id: number; stream: Stream; status: TicketStatus }>> = new Map();
    if (ogIds.length) {
      const { data: tix, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id, stream, status")
        .in("order_group_id", ogIds);
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      for (const t of tix ?? []) {
        const arr = tixByOg.get(t.order_group_id as number) ?? [];
        arr.push({ id: t.id as number, stream: (t as any).stream, status: (t as any).status });
        tixByOg.set(t.order_group_id as number, arr);
      }
    }

    function pickTicketFor(ogId: number, s: Stream | null): number | null {
      const arr = tixByOg.get(ogId) ?? [];
      if (s) {
        // prefer a ticket on that stream; else any ticket
        const onStream = arr.find((t) => t.stream === s);
        if (onStream) return onStream.id;
      }
      return arr.length ? arr[0].id : null;
    }

    const issueRows: IssueRow[] = (issues ?? []).map((i: any) => {
      const ogMeta = ogMap.get(i.order_group_id as number) ?? { order_code: "?", table_number: null };
      const resolvedTicket =
        typeof i.ticket_id === "number" ? (i.ticket_id as number) : pickTicketFor(i.order_group_id, i.stream ?? null);
      return {
        kind: "issue",
        ticket_id: resolvedTicket, // can be null; frontend can fall back to stream/order-wide when posting runner-ack
        issue_id: i.id as number,
        order_code: ogMeta.order_code,
        table_number: ogMeta.table_number,
        stream: (i.stream === "food" || i.stream === "drinks") ? (i.stream as Stream) : null,
        status: null,
        ready_at: null,
        issue_type: (i.type ?? null) as string | null,
        issue_status: i.status as any,
        created_at: i.created_at ?? null,
      };
    });

    // 3) Merge & order: show issues first (most recent first), then ready tickets by ready_at
    const merged: Row[] = [
      // newest issues first so runner sees fresh problems
      ...issueRows.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()),
      // oldest ready first so runner delivers in order
      ...deliverRows.sort((a, b) => {
        const ta = a.ready_at ? new Date(a.ready_at).getTime() : 0;
        const tb = b.ready_at ? new Date(b.ready_at).getTime() : 0;
        return ta - tb || a.ticket_id - b.ticket_id;
      }),
    ];

    return res.status(200).json({ ok: true, rows: merged });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
