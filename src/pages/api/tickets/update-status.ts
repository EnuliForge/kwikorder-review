import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

/** Full status set (includes optional 'completed') */
type Status = "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";

const ALLOWED_NEXT: Record<Exclude<Status, "completed"> | "completed", Status[]> = {
  received:  ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready:     ["delivered", "cancelled"],
  delivered: ["completed"], // optional final hop if you ever use it
  cancelled: [],
  completed: [],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Accept both POST and PATCH for flexibility
  if (req.method !== "POST" && req.method !== "PATCH") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = req.body ?? {};

  // Mode A: by ticket id (what Kitchen/Bar/Runner use)
  const hasTicketIdShape = typeof body.ticket_id !== "undefined" && typeof body.status === "string";
  // Mode B: by order_code + stream (what your old client used)
  const hasOrderStreamShape =
    typeof body.order_code === "string" &&
    (body.stream === "food" || body.stream === "drinks") &&
    typeof body.next_status === "string";

  if (!hasTicketIdShape && !hasOrderStreamShape) {
    return res.status(400).json({
      ok: false,
      error:
        "Provide either {ticket_id, status} or {order_code, stream, next_status}",
    });
  }

  // Normalize inputs
  const nextStatus: Status = (hasTicketIdShape ? body.status : body.next_status) as Status;

  if (!["received","preparing","ready","cancelled","delivered","completed"].includes(nextStatus)) {
    return res.status(400).json({ ok: false, error: "Invalid status value" });
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key, bypasses RLS for staff actions
    { auth: { persistSession: false } }
  );

  // Locate the ticket and its current status
  let ticketId: number | null = null;
  let currentStatus: Status | null = null;

  if (hasTicketIdShape) {
    const idNum = Number(body.ticket_id);
    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ ok: false, error: "ticket_id must be a number" });
    }
    const { data, error } = await supa
      .from("tickets")
      .select("id, status")
      .eq("id", idNum)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "Ticket not found" });
    ticketId = data.id as number;
    currentStatus = data.status as Status;
  } else {
    const { order_code, stream } = body as { order_code: string; stream: "food" | "drinks" };
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();
    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)   return res.status(404).json({ ok: false, error: "Order not found" });

    const { data: t, error: tErr } = await supa
      .from("tickets")
      .select("id, status")
      .eq("order_group_id", og.id)
      .eq("stream", stream)
      .maybeSingle();
    if (tErr) return res.status(500).json({ ok: false, error: tErr.message });
    if (!t)   return res.status(404).json({ ok: false, error: "Ticket not found" });
    ticketId = t.id as number;
    currentStatus = t.status as Status;
  }

  // Validate transition
  if (!currentStatus || ticketId == null) {
    return res.status(500).json({ ok: false, error: "Internal: missing ticket" });
  }
  if (!ALLOWED_NEXT[currentStatus].includes(nextStatus)) {
    return res
      .status(400)
      .json({ ok: false, error: `Illegal transition ${currentStatus} → ${nextStatus}` });
  }

  // Build patch with timestamps
  const patch: Record<string, any> = { status: nextStatus };
  const now = new Date().toISOString();
  if (nextStatus === "ready")      patch.ready_at = now;
  if (nextStatus === "delivered")  patch.delivered_at = now;
  if (nextStatus === "completed")  patch.delivered_at = patch.delivered_at ?? now;

  const { error: uErr } = await supa.from("tickets").update(patch).eq("id", ticketId);
  if (uErr) return res.status(500).json({ ok: false, error: uErr.message });

  return res.status(200).json({ ok: true, ticket_id: ticketId, new_status: nextStatus });
}
