import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { order_code, ticket_id, runner_id } = req.body ?? {};
    if (!order_code) return res.status(400).json({ ok: false, error: "order_code required" });
    if (!ticket_id)  return res.status(400).json({ ok: false, error: "ticket_id required" });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)  return res.status(404).json({ ok: false, error: "Order not found" });

    const { data: t, error: tErr } = await supa
      .from("tickets")
      .select("id, order_group_id, status")
      .eq("id", ticket_id)
      .maybeSingle();
    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
    if (!t || t.order_group_id !== og.id)
      return res.status(400).json({ ok: false, error: "ticket_id not in this order" });

    if (t.status === "delivered" || t.status === "completed") {
      return res.status(200).json({ ok: true, already: true });
    }

    const { error: uErr } = await supa
      .from("tickets")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        delivered_by: runner_id ?? null,
      })
      .eq("id", ticket_id);

    if (uErr) return res.status(500).json({ ok: false, error: uErr.message });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
