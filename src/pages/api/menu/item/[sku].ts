// src/pages/api/menu/item/[sku].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseServer } from "@/lib/supabaseServer";

type ModifierOption = {
  id: number; group_id: number; name: string;
  price_delta: number | null; is_default: boolean | null;
  is_available: boolean | null; sort_order: number | null;
};

type ModifierGroup = {
  id: number; name: string; selection: string | null;
  min_select: number | null; max_select: number | null;
  required: boolean | null; sort_order: number | null;
  options: ModifierOption[];
};

type Item = {
  id: number; sku: string; name: string; price: number;
  stream: string | null; category: string | null;
  description: string | null; image_url: string | null;
};

type Ok = { ok: true; item: Item; groups: ModifierGroup[] };
type Err = { ok: false; error: string };
type Resp = Ok | Err;

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const supa = supabaseServer();

    const raw = req.query.sku;
    const sku = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (!sku) return res.status(400).json({ ok: false, error: "sku required" });

    // Item
    const { data: item, error: iErr } = await supa
      .from("menu_items")
      .select("id, sku, name, price, stream, category, description, image_url")
      .eq("sku", sku)
      .single();
    if (iErr) throw iErr;

    // Links
    const { data: links, error: lErr } = await supa
      .from("menu_item_modifier_groups")
      .select("group_id, sort_order")
      .eq("item_id", item.id)
      .order("sort_order", { ascending: true });
    if (lErr) throw lErr;

    const groupIds = (links ?? []).map(l => l.group_id);
    let groups: ModifierGroup[] = [];

    if (groupIds.length) {
      const { data: gRows, error: gErr } = await supa
        .from("menu_modifier_groups")
        .select("id, name, selection, min_select, max_select, required, sort_order")
        .in("id", groupIds)
        .order("sort_order", { ascending: true });
      if (gErr) throw gErr;

      const { data: oRows, error: oErr } = await supa
        .from("menu_modifier_options")
        .select("id, group_id, name, price_delta, is_default, is_available, sort_order")
        .in("group_id", groupIds)
        .order("sort_order", { ascending: true });
      if (oErr) throw oErr;

      const optsByGroup = new Map<number, ModifierOption[]>();
      for (const o of oRows ?? []) {
        if (o.is_available !== false) {
          const arr = optsByGroup.get(o.group_id) ?? [];
          arr.push(o as ModifierOption);
          optsByGroup.set(o.group_id, arr);
        }
      }

      groups = (gRows ?? [])
        .map(g => ({
          ...(g as Omit<ModifierGroup, "options">),
          options: optsByGroup.get(g.id) ?? [],
        }))
        .sort((a, b) => {
          const aLink = links?.find(l => l.group_id === a.id)?.sort_order ?? 0;
          const bLink = links?.find(l => l.group_id === b.id)?.sort_order ?? 0;
          return aLink - bLink;
        });
    }

    return res.status(200).json({ ok: true, item: item as Item, groups });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: msg });
  }
}
