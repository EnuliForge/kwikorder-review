// src/pages/api/orders/client-confirm.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { order_code } = (req.body ?? {}) as { order_code?: string };
  if (!order_code) {
    return res.status(400).json({ ok: false, error: "order_code required" });
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
    { auth: { persistSession: false } }
  );

  // Get the order
  const { data: og, error: ogErr } = await supa
    .from("order_groups")
    .select("id, closed_at")
    .eq("order_code", String(order_code))
    .maybeSingle();
  if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
  if (!og)   return res.status(404).json({ ok: false, error: "order not found" });

  // Ensure all tickets are delivered/completed
  const { data: tstats, error: tErr } = await supa
    .from("tickets")
    .select("status")
    .eq("order_group_id", og.id);
  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

  const allDone = (tstats || []).every((t: any) =>
    ["delivered", "completed"].includes(String(t.status))
  );

  // Ensure no open issues
  const { data: openIssues, error: iErr } = await supa
    .from("issues")
    .select("id")
    .eq("order_group_id", og.id)
    .neq("status", "resolved");
  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

  const noOpenIssues = (openIssues || []).length === 0;

  const now = new Date().toISOString();
  const patch: any = { customer_confirmed_at: now };
  if (allDone && noOpenIssues && !og.closed_at) patch.closed_at = now;

  const { error: uErr } = await supa.from("order_groups").update(patch).eq("id", og.id);
  if (uErr) return res.status(500).json({ ok: false, error: uErr.message });

  return res.status(200).json({ ok: true, redirect_to_menu: true });
}
