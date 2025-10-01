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
    if (!Number.isFinite(tableNum) || tableNum <= 0) {
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
      const n = Number.parseFloat(String(v).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : fallback;
    };

    // IMPORTANT: fall back to baseId when id is synthetic
    const safeItems = items.map((it: any) => {
      const idOut =
        isDigits(it?.id) ? String(it.id)
        : isDigits(it?.baseId) ? String(it.baseId)
        : ""; // will become NULL in SQL

      return {
        id: idOut,
        stream: it?.stream === "drinks" ? "drinks" : "food",
        name: it?.name ? String(it.name) : "(unnamed)",
        qty: toInt(it?.qty, 1),
        price: toNumber(it?.price, 0),
        // optional passthroughs (SQL currently ignores but safe to include)
        notes: it?.notes ? String(it.notes) : null,
      };
    });

    const { data, error } = await supa.rpc("create_order_with_items", {
      p_table_number: tableNum,
      p_items: safeItems, // JSONB
    });

    if (error) return res.status(500).json({ ok: false, error: error.message });

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
