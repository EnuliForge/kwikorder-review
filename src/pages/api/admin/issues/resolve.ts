import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { issue_id, resolution_note } = req.body || {};
  if (!issue_id) return res.status(400).json({ ok: false, error: "issue_id required" });

  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { error } = await supa
      .from("issues")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_note: resolution_note || null,
      })
      .eq("id", issue_id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
