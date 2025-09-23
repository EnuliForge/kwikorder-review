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
      .from("issues")
      .select(`
        id,
        status,
        type,
        description,
        created_at,
        order_groups ( order_code, table_number ),
        tickets ( stream )
      `)
      .neq("status", "resolved")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });

    const rows = (data || []).map((r: any) => ({
      id: r.id,
      status: r.status,
      type: r.type,
      description: r.description,
      created_at: r.created_at,
      order_code: r.order_groups?.order_code || "—",
      table_number: r.order_groups?.table_number ?? null,
      stream: r.tickets?.stream ?? null,
    }));

    return res.status(200).json({ ok: true, rows });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
