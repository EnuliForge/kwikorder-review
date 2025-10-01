// src/pages/api/menu/item.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const id = Number(req.query.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Missing or invalid id" });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    // item
    const { data: item, error: e1 } = await supa
      .from("menu_items")
      .select("*")
      .eq("id", id)
      .eq("hidden", false)
      .eq("is_available", true)
      .single();
    if (e1) return res.status(404).json({ ok: false, error: e1.message });
    if (!item) return res.status(404).json({ ok: false, error: "Not found" });

    // links -> groups
    const { data: links, error: e2 } = await supa
      .from("menu_item_modifier_groups")
      .select("*")
      .eq("item_id", id)
      .order("sort_order", { ascending: true });
    if (e2) return res.status(500).json({ ok: false, error: e2.message });

    const groupIds = Array.from(new Set((links ?? []).map(l => Number(l.group_id))));
    let groups: any[] = [];
    if (groupIds.length) {
      const { data: groupsRaw, error: e3 } = await supa
        .from("menu_modifier_groups")
        .select("*")
        .in("id", groupIds)
        .order("sort_order", { ascending: true });
      if (e3) return res.status(500).json({ ok: false, error: e3.message });

      const { data: optsRaw, error: e4 } = await supa
        .from("menu_modifier_options")
        .select("*")
        .in("group_id", groupIds)
        .order("sort_order", { ascending: true });
      if (e4) return res.status(500).json({ ok: false, error: e4.message });

      const byId = new Map<number, any>();
      (groupsRaw ?? []).forEach(g => {
        byId.set(Number(g.id), {
          id: Number(g.id),
          name: String(g.name),
          selection: g.selection === "multiple" ? "multiple" : "single",
          required: !!g.required,
          min_select: Number(g.min_select ?? 0),
          max_select: Number(g.max_select ?? 1),
          sort_order: Number(g.sort_order ?? 0),
          options: [] as any[],
        });
      });
      (optsRaw ?? []).forEach(o => {
        const bucket = byId.get(Number(o.group_id));
        if (!bucket) return;
        bucket.options.push({
          id: Number(o.id),
          group_id: Number(o.group_id),
          name: String(o.name),
          price_delta: Number(o.price_delta ?? 0),
          is_default: !!o.is_default,
          is_available: !!o.is_available,
          sort_order: Number(o.sort_order ?? 0),
        });
      });

      // keep item-specific group order
      const orderMap = new Map(groupIds.map((gid, i) => [gid, i]));
      groups = Array.from(byId.values()).sort(
        (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0)
      );
    }

    const payload = {
      id: Number(item.id),
      sku: String(item.sku),
      name: String(item.name),
      price: Number(item.price ?? 0),
      stream: item.stream as "food" | "drinks",
      category: item.category ?? null,
      description: item.description ?? null,
      image_url: item.image_url ?? null,
      sort_order: Number(item.sort_order ?? 0),
      updated_at: item.updated_at ?? null,
      groups,
    };

    return res.status(200).json({ ok: true, item: payload });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
