// src/pages/api/menu/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseServer } from "@/lib/supabaseServer";

import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stream = String(req.query.stream ?? "all").toLowerCase(); // food|drinks|all

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // read-only
      { auth: { persistSession: false } }
    );

    const streamParam = (req.query.stream as string | undefined)?.toLowerCase(); // "food" | "drinks"
    const q = (req.query.q as string | undefined)?.trim();
    const includeHidden = req.query.includeHidden === "1";

    // 1) Items (optionally filter by stream/search; hide unavailable unless includeHidden=1)
    let itemsQ = supa
      .from("menu_items")
      .select("id, sku, name, price, stream, category, description, image_url, sort_order, is_available, hidden")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (streamParam === "food" || streamParam === "drinks") {
      itemsQ = itemsQ.eq("stream", streamParam);
    }
    if (!includeHidden) {
      itemsQ = itemsQ.eq("hidden", false).eq("is_available", true);
    }
    if (q) {
      itemsQ = itemsQ.ilike("name", `%${q}%`);
    }

    const { data: itemsRaw, error: itemErr } = await itemsQ;
    if (itemErr) throw itemErr;

    const items = (itemsRaw ?? []).map((r) => ({
      id: Number(r.id),
      sku: String(r.sku),
      name: String(r.name),
      price: Number(r.price ?? 0),
      stream: r.stream as "food" | "drinks",
      category: r.category ?? null,
      description: r.description ?? null,
      image_url: r.image_url ?? null,
      sort_order: Number(r.sort_order ?? 0),
    }));

    if (items.length === 0) {
      return res.status(200).json({ ok: true, items: [] });
    }

    // 2) Item -> group links
    const itemIds = items.map((i) => i.id);
    const { data: links, error: linkErr } = await supa
      .from("menu_item_modifier_groups")
      .select("item_id, group_id, sort_order")
      .in("item_id", itemIds)
      .order("sort_order", { ascending: true });
    if (linkErr) throw linkErr;

    const groupIds = Array.from(new Set((links ?? []).map((l) => Number(l.group_id))));
    if (groupIds.length === 0) {
      return res.status(200).json({ ok: true, items: items.map((i) => ({ ...i, groups: [] })) });
    }

    // 3) Groups + options (only include available options)
    const [{ data: groupsRaw, error: gErr }, { data: optsRaw, error: oErr }] = await Promise.all([
      supa
        .from("menu_modifier_groups")
        .select("id, name, selection, min_select, max_select, required, sort_order")
        .in("id", groupIds)
        .order("sort_order", { ascending: true }),
      supa
        .from("menu_modifier_options")
        .select("id, group_id, name, price_delta, is_default, is_available, sort_order")
        .in("group_id", groupIds)
        .order("sort_order", { ascending: true }),
    ]);
    if (gErr) throw gErr;
    if (oErr) throw oErr;

    const groupsById = new Map<number, any>();
    for (const g of groupsRaw ?? []) {
      groupsById.set(Number(g.id), {
        id: Number(g.id),
        name: String(g.name),
        selection: g.selection === "multiple" ? "multiple" : "single",
        required: Boolean(g.required),
        min_select: Number(g.min_select ?? 0),
        max_select: Number(g.max_select ?? 1),
        sort_order: Number(g.sort_order ?? 0),
        options: [] as any[],
      });
    }
    for (const o of optsRaw ?? []) {
      if (o.is_available === false) continue;
      const gid = Number(o.group_id);
      const bucket = groupsById.get(gid);
      if (!bucket) continue;
      bucket.options.push({
        id: Number(o.id),
        group_id: gid,
        name: String(o.name),
        price_delta: Number(o.price_delta ?? 0),
        is_default: Boolean(o.is_default),
        is_available: true,
        sort_order: Number(o.sort_order ?? 0),
      });
    }

    // 4) Attach groups to items in link order
    const linksByItem = new Map<number, { group_id: number; sort_order: number }[]>();
    for (const l of links ?? []) {
      const arr = linksByItem.get(l.item_id) ?? [];
      arr.push({ group_id: Number(l.group_id), sort_order: Number(l.sort_order ?? 0) });
      linksByItem.set(Number(l.item_id), arr);
    }

    const payload = items.map((i) => {
      const arr = (linksByItem.get(i.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      const groups = arr.map(({ group_id }) => groupsById.get(group_id)).filter(Boolean);
      return { ...i, groups };
    });

    return res.status(200).json({ ok: true, items: payload });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
