// src/pages/api/issues/client-ack.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { order_code } = (req.body ?? {}) as { order_code?: string };
  if (!order_code) return res.status(400).json({ ok: false, error: "order_code required" });

  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server key so RLS won't block this
      { auth: { persistSession: false } }
    );

    // 1) Locate order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id, closed_at, customer_confirmed_at")
      .eq("order_code", order_code)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)   return res.status(404).json({ ok: false, error: "order not found" });

    const now = new Date().toISOString();

    // 2) Resolve all open/acked issues for this order
    const { data: updatedIssues, error: updErr } = await supa
      .from("issues")
      .update({ status: "resolved", resolved_at: now })
      .eq("order_group_id", og.id)
      .neq("status", "resolved")
      .select("id");
    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    // 3) Clear the flag on the order
    const { error: flagErr } = await supa
      .from("order_groups")
      .update({ resolution_required: false })
      .eq("id", og.id);
    if (flagErr) return res.status(500).json({ ok: false, error: flagErr.message });

    // 4) If all tickets are delivered/completed, confirm & close the order
    const { data: tstats, error: tErr } = await supa
      .from("tickets")
      .select("status")
      .eq("order_group_id", og.id);
    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

    const allDone = (tstats || []).every((t: any) =>
      ["delivered", "completed"].includes(String(t.status))
    );

    let redirect_to_menu = false;

    if (allDone) {
      const patch: any = { customer_confirmed_at: now };
      if (!og.closed_at) patch.closed_at = now;

      const { error: closeErr } = await supa
        .from("order_groups")
        .update(patch)
        .eq("id", og.id);
      if (closeErr) return res.status(500).json({ ok: false, error: closeErr.message });

      redirect_to_menu = true;
    }

    return res.status(200).json({
      ok: true,
      resolved_count: (updatedIssues || []).length,
      redirect_to_menu,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
