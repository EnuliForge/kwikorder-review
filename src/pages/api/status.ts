import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const oc = String(req.query.order_code || "");
  if (!oc) return res.status(400).json({ ok: false, error: "order_code required" });

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .select("id, closed_at")
    .eq("order_code", oc)
    .maybeSingle();
  if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
  if (!og) return res.status(200).json({ ok: true, tickets: [], closed_at: null });

  // fetch tickets + their line items + any existing issues (only id needed)
  const { data: tickets, error: tErr } = await supa
    .from("tickets")
    .select(`
      id,
      stream,
      status,
      delivered_at,
      ready_at,
      created_at,
      ticket_line_items ( name, qty ),
      issues ( id )
    `)
    .eq("order_group_id", og.id)
    .order("stream", { ascending: true });

  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

  const norm = (tickets ?? []).map((t: any) => ({
    id: t.id,
    stream: t.stream,
    status: t.status,
    delivered_at: t.delivered_at,
    ready_at: t.ready_at,
    created_at: t.created_at,
    items: (t.ticket_line_items || []).map((li: any) => ({ name: li.name, qty: li.qty })),
    has_issue: Array.isArray(t.issues) && t.issues.length > 0,
  }));

  return res.status(200).json({ ok: true, tickets: norm, closed_at: og.closed_at ?? null });
}
