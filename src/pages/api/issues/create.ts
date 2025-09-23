import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { order_code, ticket_id, type, description } = req.body ?? {};
    if (!order_code) return res.status(400).json({ ok: false, error: "order_code required" });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 1) Resolve order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)  return res.status(404).json({ ok: false, error: "Order not found" });

    // 2) Optional: validate ticket belongs to this order
    let stream: "food" | "drinks" | null = null;
    if (ticket_id) {
      const { data: t, error: tErr } = await supa
        .from("tickets")
        .select("id, order_group_id, stream")
        .eq("id", ticket_id)
        .maybeSingle();
      if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
      if (!t || t.order_group_id !== og.id)
        return res.status(400).json({ ok: false, error: "ticket_id not in this order" });
      stream = (t.stream === "food" || t.stream === "drinks") ? t.stream : null;
    }

    // 3) Insert issue with correct order_group_id
    const ins = {
      order_group_id: og.id,
      ticket_id: ticket_id ?? null,
      type: type ?? "other",
      description: description ?? null,
      status: "open" as const,
      // Optionally store stream for convenience:
      ...(stream ? { stream } : {}),
    };

    const { error: iErr } = await supa.from("issues").insert(ins);
    if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
