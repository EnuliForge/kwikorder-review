import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server key
      { auth: { persistSession: false } }
    );

    const q = String(req.query.q ?? "").trim();
    const stream = String(req.query.stream ?? "").trim().toLowerCase(); // "food" | "drinks" | "all" | ""
    const includeHidden = String(req.query.include_hidden ?? "true") !== "false";
    const includeUnavailable = String(req.query.include_unavailable ?? "true") !== "false";

    // Select everything to be schema-tolerant (avoid selecting non-existent columns explicitly)
    let qry = supa.from("menu_items").select("*"); // .order("name") removed to avoid 500s if name column differs

    if (q) qry = qry.ilike("name", `%${q}%`);
    if (stream && stream !== "all") qry = qry.eq("stream", stream);

    const { data, error } = await qry;

    if (error) {
      // Surface the exact message to the client for quick diagnosis
      return res.status(500).json({ ok: false, error: error.message });
    }

    const rows = (data ?? []).map((r: any) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      price: Number(r.price ?? 0),
      stream: r.stream === "food" || r.stream === "drinks" ? (r.stream as "food" | "drinks") : null,
      hidden: "hidden" in r ? Boolean(r.hidden) : false,
      // tolerate either is_available or legacy is_unavailable (invert)
      is_available:
        "is_available" in r
          ? Boolean(r.is_available)
          : "is_unavailable" in r
          ? !Boolean(r.is_unavailable)
          : true,
      updated_at: r.updated_at ?? null,
    }));

    const filtered = rows.filter((r) => {
      if (!includeHidden && r.hidden) return false;
      if (!includeUnavailable && !r.is_available) return false;
      return true;
    });

    // sort by name safely on client side
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({ ok: true, items: filtered });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
