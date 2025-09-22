import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type CartItem = {
  id?: number | string | null;     // optional menu id
  name: string;
  qty: number;
  price?: number | string | null;  // not used in DB write right now
  stream: "food" | "drinks";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { table_number, items } = (req.body ?? {}) as {
      table_number?: number | null;
      items?: CartItem[];
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "items[] required" });
    }

    // Basic validation/sanitization
    for (const it of items) {
      if (!it?.name || typeof it.name !== "string") {
        return res.status(400).json({ ok: false, error: "each item requires name" });
      }
      if (it.stream !== "food" && it.stream !== "drinks") {
        return res.status(400).json({ ok: false, error: "each item requires stream = 'food' | 'drinks'" });
      }
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        return res.status(400).json({ ok: false, error: "each item requires qty > 0" });
      }
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
      { auth: { persistSession: false } }
    );

    // Call the DB helper to create the order, split into tickets, and insert line items
    const { data, error } = await supa.rpc("create_order_with_items", {
      p_table_number: table_number ?? null,
      p_items: items as any, // supabase-js will send this as JSONB
    });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Function returns table(order_code text) — supabase gives it as an array of rows
    const order_code =
      Array.isArray(data) && data.length > 0 ? (data[0] as any).order_code : null;

    if (!order_code) {
      return res.status(500).json({ ok: false, error: "Failed to generate order_code" });
    }

    return res.status(200).json({ ok: true, order_code });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
