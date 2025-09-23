// src/pages/api/orders/create.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { table_number, items } = req.body ?? {};
    const tableNum = Number(table_number);
    if (!Number.isFinite(tableNum)) {
      return res.status(400).json({ ok: false, error: "table_number must be numeric" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "items must be a non-empty array" });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only
      { auth: { persistSession: false } }
    );

    const isDigits = (v: any) =>
      (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
      (typeof v === "string" && /^\d+$/.test(v));

    const toInt = (v: any, fallback = 1) => {
      const n = Number.parseInt(String(v), 10);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const toNumber = (v: any, fallback = 0) => {
      if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
      // strip currency symbols/spaces (e.g., "K 365.00")
      const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : fallback;
    };

    // Sanitize cart items for the SQL function
    const safeItems = items.map((it: any) => ({
      // IMPORTANT: id must be digits-only; otherwise set to empty string
      id: isDigits(it?.id) ? String(it.id) : "",
      // stream must be "food" | "drinks" (default to "food" if missing)
      stream: it?.stream === "drinks" ? "drinks" : "food",
      name: it?.name ? String(it.name) : "(unnamed)",
      qty: toInt(it?.qty, 1),
      price: toNumber(it?.price, 0), // your SQL casts elem->>'price'::numeric
    }));

    // Call your SQL function (returns table(order_code text))
    const { data, error } = await supa.rpc("create_order_with_items", {
      p_table_number: tableNum,
      p_items: safeItems, // JSONB on the SQL side
    });

    if (error) return res.status(500).json({ ok: false, error: error.message });

    // Supabase RPC can return either an array of rows or a single row
    const order_code =
      (Array.isArray(data) ? data[0]?.order_code : (data as any)?.order_code) ?? null;

    if (!order_code) {
      return res.status(500).json({ ok: false, error: "Could not create order" });
    }

    return res.status(200).json({ ok: true, order_code });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
