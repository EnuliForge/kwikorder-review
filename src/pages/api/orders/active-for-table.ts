import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const tableRaw = req.query.table;
    const table = Number(Array.isArray(tableRaw) ? tableRaw[0] : tableRaw);
    if (!Number.isFinite(table)) return res.status(400).json({ ok: false, error: "table must be a number" });

    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

    const { data, error } = await supa
      .from("order_groups")
      .select("id, order_code, table_number, created_at, resolution_required, closed_at")
      .eq("table_number", table)
      .is("closed_at", null)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });

    const orders = (data ?? []).map((o) => ({
      id: o.id as number,
      order_code: String(o.order_code),
      table_number: (o as any).table_number ?? null,
      created_at: (o as any).created_at as string,
      resolution_required: Boolean((o as any).resolution_required),
    }));
    res.status(200).json({ ok: true, orders });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
