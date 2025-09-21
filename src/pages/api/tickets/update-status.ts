import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Status = "received" | "preparing" | "ready" | "cancelled" | "delivered";

const ALLOWED_NEXT: Record<Status, Status[]> = {
  received:   ["preparing", "cancelled"],
  preparing:  ["ready", "cancelled"],
  ready:      ["delivered", "cancelled"],
  delivered:  [],               // terminal
  cancelled:  [],               // terminal
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { order_code, stream, next_status } = req.body ?? {};
  if (!order_code || (stream !== "food" && stream !== "drinks") || !next_status)
    return res.status(400).json({ ok: false, error: "order_code, stream, next_status required" });

  const ns: Status = next_status;
  if (!["received","preparing","ready","cancelled","delivered"].includes(ns))
    return res.status(400).json({ ok: false, error: "Invalid next_status" });

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,   // server-only
    { auth: { persistSession: false } }
  );

  // locate order_group + ticket
  const { data: og, error: ogErr } = await supa
    .from("order_groups").select("id").eq("order_code", order_code).maybeSingle();
  if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
  if (!og)   return res.status(404).json({ ok: false, error: "Order not found" });

  const { data: t, error: tErr } = await supa
    .from("tickets")
    .select("id,status")
    .eq("order_group_id", og.id)
    .eq("stream", stream)
    .maybeSingle();
  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
  if (!t)   return res.status(404).json({ ok: false, error: "Ticket not found" });

  if (!ALLOWED_NEXT[t.status as Status].includes(ns)) {
    return res.status(400).json({ ok: false, error: `Illegal transition ${t.status} → ${ns}` });
  }

  // set timestamps when appropriate
  const patch: any = { status: ns };
  if (ns === "ready")      patch.ready_at = new Date().toISOString();
  if (ns === "delivered")  patch.delivered_at = new Date().toISOString();

  const { error: uErr } = await supa.from("tickets").update(patch).eq("id", t.id);
  if (uErr) return res.status(500).json({ ok: false, error: uErr.message });

  return res.status(200).json({ ok: true, ticket_id: t.id, new_status: ns });
}
