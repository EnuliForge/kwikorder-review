import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = req.body ?? {};
    const itemId = Number(body.id);
    if (!Number.isFinite(itemId)) {
      return res.status(400).json({ ok: false, error: "Valid id required" });
    }

    const patch: Record<string, any> = {};
    if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
    if (typeof body.is_available === "boolean") patch.is_available = body.is_available;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: "No fields to update" });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supa
      .from("menu_items")
      .update(patch)
      .eq("id", itemId)
      .select("*")
      .maybeSingle();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data)  return res.status(404).json({ ok: false, error: "Item not found" });

    return res.status(200).json({ ok: true, item: data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
