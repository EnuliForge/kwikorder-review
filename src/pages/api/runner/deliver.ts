import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { ticket_id, runner_user_id } = req.body ?? {};
  const id = Number(ticket_id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "ticket_id must be a number" });

  try {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await s
      .from("tickets")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        delivered_by: runner_user_id ?? null,
      })
      .eq("id", id)
      .eq("status", "ready")
      .select("id")
      .maybeSingle();

    if (error) return res.status(400).json({ ok: false, error: error.message });
    if (!data)  return res.status(409).json({ ok: false, error: "Ticket is not ready or not found" });

    return res.status(200).json({ ok: true, ticket_id: data.id });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
