import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type CartLine = {
  id: number | string;
  name: string;
  price: number;
  qty: number;
  stream: "food" | "drinks";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { table_number, items } = req.body ?? {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items[] required" });
  }

  const clean: CartLine[] = [];
  for (const it of items) {
    if (!it) continue;
    const stream = it.stream;
    if (stream !== "food" && stream !== "drinks") {
      return res.status(400).json({ ok: false, error: "Invalid stream in items" });
    }
    const qty = Number(it.qty ?? 1);
    if (qty <= 0) continue;

    clean.push({
      id: it.id,
      name: String(it.name ?? ""),
      price: Number(it.price ?? 0),
      qty,
      stream,
    });
  }
  if (clean.length === 0) return res.status(400).json({ ok: false, error: "No valid items" });

  try {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server key
      { auth: { persistSession: false } }
    );

    const { data, error } = await s.rpc("create_order_with_items", {
      p_table_number: table_number ?? null,
      p_items: clean as any, // Supabase JSON-encodes
    });

    if (error) return res.status(400).json({ ok: false, error: error.message });

    const order_code =
      Array.isArray(data) ? data[0]?.order_code : (data as any)?.order_code;

    if (!order_code) return res.status(500).json({ ok: false, error: "No order_code returned" });

    return res.status(200).json({ ok: true, order_code });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
