// src/pages/api/issues/client-ack.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { order_code, ticket_id } = req.body ?? {};
    if (!order_code) return res.status(400).json({ ok: false, error: "order_code required" });
    if (!ticket_id)  return res.status(400).json({ ok: false, error: "ticket_id required" });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    // 1) Find order group + ticket to know stream
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)   return res.status(404).json({ ok: false, error: "order not found" });

    const { data: t, error: tErr } = await supa
      .from("tickets")
      .select("id, order_group_id, stream")
      .eq("id", ticket_id)
      .maybeSingle();
    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
    if (!t || t.order_group_id !== og.id) {
      return res.status(400).json({ ok: false, error: "ticket_id not in this order" });
    }

    const now = new Date().toISOString();
    let resolvedCount = 0;

    // 2a) Resolve issues explicitly attached to this ticket
    {
      const { data, error } = await supa
        .from("issues")
        .update({ status: "resolved", resolved_at: now })
        .eq("order_group_id", og.id)
        .eq("ticket_id", ticket_id)
        .neq("status", "resolved")
        .select("id");
      if (error && error.message?.toLowerCase().includes("does not exist")) {
        // Ignore rare PostgREST aliasing error; continue with stream/order-wide below
      } else if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      } else {
        resolvedCount += (data ?? []).length;
      }
    }

    // 2b) Resolve stream-level issues that apply to this ticket's stream
    {
      const { data, error } = await supa
        .from("issues")
        .update({ status: "resolved", resolved_at: now })
        .eq("order_group_id", og.id)
        .is("ticket_id", null)
        .eq("stream", t.stream)
        .neq("status", "resolved")
        .select("id");
      if (error) return res.status(500).json({ ok: false, error: error.message });
      resolvedCount += (data ?? []).length;
    }

    // 2c) Resolve order-wide issues
    {
      const { data, error } = await supa
        .from("issues")
        .update({ status: "resolved", resolved_at: now })
        .eq("order_group_id", og.id)
        .is("ticket_id", null)
        .is("stream", null)
        .neq("status", "resolved")
        .select("id");
      if (error) return res.status(500).json({ ok: false, error: error.message });
      resolvedCount += (data ?? []).length;
    }

    // Triggers will clear order_groups.resolution_required when all are resolved.
    return res.status(200).json({ ok: true, resolved_count: resolvedCount });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
