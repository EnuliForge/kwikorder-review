import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Mode = "runner_ack" | "resolve";
type Stream = "food" | "drinks";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      order_code,
      mode,
      ticket_id,
      stream,
      order_wide,
      description,
      resolution, // used when resolving
    }: {
      order_code?: string;
      mode?: Mode;
      ticket_id?: number;
      stream?: Stream;
      order_wide?: boolean;
      description?: string | null;
      resolution?: string | null;
    } = req.body || {};

    if (!order_code) {
      return res.status(400).json({ ok: false, error: "order_code required" });
    }
    const op: Mode = mode === "resolve" ? "resolve" : "runner_ack";

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
      { auth: { persistSession: false } }
    );

    // 1) Resolve order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)   return res.status(404).json({ ok: false, error: "order not found" });

    // 2) Normalize target: ticket-level, stream-level, or order-wide
    let normStream: Stream | null = null;
    let normTicketId: number | null = null;
    let scope: "ticket" | "stream" | "order" = "order";

    if (ticket_id) {
      // Validate ticket belongs to this order; also infer stream
      const { data: t, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id, stream")
        .eq("id", ticket_id)
        .maybeSingle();
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      if (!t || t.order_group_id !== og.id) {
        return res.status(400).json({ ok: false, error: "ticket_id not in this order" });
      }
      normTicketId = t.id as number;
      // @ts-ignore — runtime enum on db side
      normStream = t.stream === "food" || t.stream === "drinks" ? (t.stream as Stream) : null;
      scope = "ticket";
    } else if (stream === "food" || stream === "drinks") {
      normStream = stream;
      normTicketId = null;
      scope = "stream";
    } else {
      // default if neither ticket nor stream explicitly given
      normStream = null;
      normTicketId = null;
      scope = order_wide ? "order" : "order";
    }

    if (op === "runner_ack") {
      // 3A) Try UPDATE first: set existing matching issues to runner_ack
      let q = supa
        .from("issues")
        .update({ status: "runner_ack" })
        .eq("order_group_id", og.id)
        .neq("status", "resolved");

      if (scope === "ticket") {
        q = q.eq("ticket_id", normTicketId);
      } else if (scope === "stream") {
        q = q.is("ticket_id", null).eq("stream", normStream as Stream);
      } else {
        // order-wide
        q = q.is("ticket_id", null).is("stream", null);
      }

      const { data: updRows, error: updErr } = await q.select("id");
      if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

      // 3B) If nothing was updated, INSERT a new runner_ack issue
      let insertedId: number | null = null;
      if (!updRows || updRows.length === 0) {
        const payload: any = {
          order_group_id: og.id,
          ticket_id: normTicketId,                 // null for stream/order-wide
          stream: normStream,                      // requires issues.stream; remove if you don't have column
          type: "other",
          status: "runner_ack",
          description: description ?? null,
        };
        const { data: ins, error: insErr } = await supa
          .from("issues")
          .insert(payload)
          .select("id")
          .maybeSingle();
        if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
        insertedId = ins?.id ?? null;
      }

      // 3C) Ensure banner visible (helps if we only UPDATED to runner_ack)
      await supa.from("order_groups").update({ resolution_required: true }).eq("id", og.id);

      return res.status(200).json({
        ok: true,
        mode: "runner_ack",
        updated_count: updRows?.length ?? 0,
        inserted_id: insertedId,
        scope,
      });
    }

    // -------- resolve mode ----------
    const now = new Date().toISOString();

    let rq = supa
      .from("issues")
      .update({ status: "resolved", resolved_at: now, resolution: resolution ?? null })
      .eq("order_group_id", og.id)
      .neq("status", "resolved");

    if (scope === "ticket") {
      rq = rq.eq("ticket_id", normTicketId);
    } else if (scope === "stream") {
      rq = rq.is("ticket_id", null).eq("stream", normStream as Stream);
    } else {
      rq = rq.is("ticket_id", null).is("stream", null);
    }

    const { data: resolvedRows, error: rErr } = await rq.select("id");
    if (rErr) return res.status(500).json({ ok: false, error: rErr.message });

    // Let your issue-update trigger clear resolution_required when no open issues remain.
    // (Optional eager clear - harmless if triggers already handle it)
    // await supa.from("order_groups").update({ resolution_required: false }).eq("id", og.id);

    return res.status(200).json({
      ok: true,
      mode: "resolve",
      resolved_count: resolvedRows?.length ?? 0,
      scope,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
