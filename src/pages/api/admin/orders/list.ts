import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supa
      .from("order_groups")
      .select(`
        id,
        order_code,
        table_number,
        created_at,
        closed_at,
        resolution_required,
        tickets ( id, stream, status, ready_at, delivered_at ),
        issues ( status )
      `)
      .is("closed_at", null)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
