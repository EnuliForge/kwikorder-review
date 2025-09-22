// src/pages/api/orders/create.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Stream = "food" | "drinks";
type IncomingItem = {
  id?: number | string | null;
  name: string;
  price?: number | null; // optional here; not required by DB
  qty: number;
  stream: Stream;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { table_number, items } = (req.body ?? {}) as {
      table_number?: number;
      items?: IncomingItem[];
    };

    // Basic validation
    const tn = Number(table_number);
    if (!Number.isFinite(tn) || tn <= 0) {
      return res.status(400).json({ ok: false, error: "Valid table_number required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "items array required" });
    }

    const normalized = items.map((it, i) => {
      const qty = Number(it.qty);
      const stream = String(it.stream);
      if (!["food", "drinks"].includes(stream)) {
        throw new Error(`items[${i}].stream must be "food" or "drinks"`);
      }
      if (!qty || qty < 1) {
        throw new Error(`items[${i}].qty must be >= 1`);
      }
      const name = (it.name || "").trim();
      if (!name) {
        throw new Error(`items[${i}].name required`);
      }
      return {
        id: it.id ?? null,
        name,
        price: Number.isFinite(Number(it.price)) ? Number(it.price) : null,
        qty,
        stream, // "food" | "drinks"
      };
    });

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role to bypass RLS for write
      { auth: { persistSession: false } }
    );

    // Call the DB function to create order + split into tickets + insert line items
    const { data, error } = await supa.rpc("create_order_with_items", {
      p_table_number: tn,
      p_items: normalized as any, // jsonb
    });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Function returns table(order_code text)
    const order_code: string | undefined =
      Array.isArray(data) && data.length > 0 ? (data[0] as any).order_code : undefined;

    if (!order_code) {
      return res.status(500).json({ ok: false, error: "Failed to create order (no code returned)" });
    }

    return res.status(200).json({ ok: true, order_code });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
