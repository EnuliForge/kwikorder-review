import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const TYPES_BY_STREAM: Record<"food" | "drinks", Record<string, true>> = {
  food: { wrong_food: true, missing_item: true, cold: true, hygiene: true, other: true },
  drinks: { wrong_drink: true, missing_item: true, cold: true, hygiene: true, other: true },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { order_code, ticket_id, type, description } = req.body ?? {};
  if (!order_code || !ticket_id || !type) {
    return res.status(400).json({ ok: false, error: "order_code, ticket_id and type are required" });
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 1) Order group
  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .select("id")
    .eq("order_code", order_code)
    .maybeSingle();
  if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
  if (!og) return res.status(404).json({ ok: false, error: "Order not found" });

  // 2) Ticket (must belong + be delivered)
  const { data: ticket, error: tErr } = await supa
    .from("tickets")
    .select("id, status, order_group_id, stream")
    .eq("id", ticket_id)
    .maybeSingle();
  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
  if (!ticket || ticket.order_group_id !== og.id)
    return res.status(400).json({ ok: false, error: "Ticket does not belong to this order" });
  if (ticket.status !== "delivered")
    return res.status(400).json({ ok: false, error: "Issues can be filed only after delivery" });

  // 3) Stream-specific type validation
  const stream: "food" | "drinks" = ticket.stream as any;
  if (!TYPES_BY_STREAM[stream]?.[type]) {
    return res.status(400).json({ ok: false, error: `Invalid issue type '${type}' for stream '${stream}'` });
  }

  // 4) Insert
  const { data: ins, error: iErr } = await supa
    .from("issues")
    .insert({
      ticket_id: ticket.id,
      order_group_id: og.id,
      type,
      description: description ?? null,
    })
    .select("id")
    .maybeSingle();

  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });
  return res.status(200).json({ ok: true, issue_id: ins?.id });
}
