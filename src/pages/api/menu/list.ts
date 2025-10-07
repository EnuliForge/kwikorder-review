// src/pages/api/menu/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js"; // anon key for read-only menu

/* --------------------------- Local helper funcs --------------------------- */
function getStr(query: any, key: string, def = ""): string {
  const raw = query?.[key];
  const one = Array.isArray(raw) ? raw[0] : raw;
  return one ? String(one) : def;
}

function getBool(query: any, key: string, def = false): boolean {
  const raw = query?.[key];
  const one = Array.isArray(raw) ? raw[0] : raw;
  if (one == null) return def;
  const s = String(one).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/* ----------------------------- Types ----------------------------- */
type Stream = "food" | "drinks" | "all";

type ItemRow = {
  id: number;
  sku: string;
  name: string;
  price: number | null;
  stream: "food" | "drinks" | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number | null;
  is_available: boolean | null;
  hidden: boolean | null;
};

type ItemOut = {
  id: number;
  sku: string;
  name: string;
  price: number;
  stream: "food" | "drinks";
  category: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  groups?: ModifierGroupOut[];
};

type LinkRow = { item_id: number; group_id: number; sort_order: number | null };

type GroupRow = {
  id: number;
  name: string;
  selection: string | null;
  min_select: number | null;
  max_select: number | null;
  required: boolean | null;
  sort_order: number | null;
};

type OptionRow = {
  id: number;
  group_id: number;
  name: string;
  price_delta: number | null;
  is_default: boolean | null;
  is_available: boolean | null;
  sort_order: number | null;
};

type ModifierOptionOut = {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: true;
  sort_order: number;
};

type ModifierGroupOut = {
  id: number;
  name: string;
  selection: "single" | "multiple";
  required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: ModifierOptionOut[];
};

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    // Normalize query params
    const streamRaw = (getStr(req.query, "stream") ?? "all").toLowerCase();
    const stream: Stream = streamRaw === "food" || streamRaw === "drinks" ? streamRaw : "all";

    const q = (getStr(req.query, "q") ?? "").trim();
    const includeHidden = getBool(req.query, "includeHidden", false);

    // Supabase anon client (read-only)
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    /* ------------------------------- 1) Items ------------------------------- */
    let itemsQ = supa
      .from("menu_items")
      .select(
        "id, sku, name, price, stream, category, description, image_url, sort_order, is_available, hidden"
      )
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (stream === "food" || stream === "drinks") {
      itemsQ = itemsQ.eq("stream", stream);
    }
    if (!includeHidden) {
      itemsQ = itemsQ.eq("hidden", false).eq("is_available", true);
    }
    if (q) {
      itemsQ = itemsQ.ilike("name", `%${q}%`);
    }

    const { data: itemsRaw, error: itemErr } = await itemsQ;
    if (itemErr) throw itemErr;

    const items: ItemOut[] = (itemsRaw ?? []).map((r: any) => {
      const it = r as ItemRow;
      return {
        id: Number(it.id),
        sku: String(it.sku),
        name: String(it.name),
        price: Number(it.price ?? 0),
        stream: (it.stream ?? "food") as "food" | "drinks",
        category: it.category ?? null,
        description: it.description ?? null,
        image_url: it.image_url ?? null,
        sort_order: Number(it.sort_order ?? 0),
      };
    });

    if (items.length === 0) {
      return res.status(200).json({ ok: true, items: [] });
    }

    /* ------------------------- 2) Item -> group links ------------------------ */
    const itemIds = items.map((i) => i.id);
    const { data: links, error: linkErr } = await supa
      .from("menu_item_modifier_groups")
      .select("item_id, group_id, sort_order")
      .in("item_id", itemIds)
      .order("sort_order", { ascending: true });
    if (linkErr) throw linkErr;

    const groupIds = Array.from(new Set((links ?? []).map((l: any) => Number((l as LinkRow).group_id))));
    if (groupIds.length === 0) {
      return res.status(200).json({ ok: true, items: items.map((i) => ({ ...i, groups: [] })) });
    }

    /* ------------------------- 3) Groups + Options --------------------------- */
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

    const groupsById = new Map<number, ModifierGroupOut>();

    for (const g of (groupsRaw ?? []) as any[]) {
      const gr = g as GroupRow;
      groupsById.set(Number(gr.id), {
        id: Number(gr.id),
        name: String(gr.name),
        selection: gr.selection === "multiple" ? "multiple" : "single",
        required: Boolean(gr.required),
        min_select: Number(gr.min_select ?? 0),
        max_select: Number(gr.max_select ?? 1),
        sort_order: Number(gr.sort_order ?? 0),
        options: [],
      });
    }

    for (const o of (optsRaw ?? []) as any[]) {
      const op = o as OptionRow;
      if (op.is_available === false) continue;
      const gid = Number(op.group_id);
      const bucket = groupsById.get(gid);
      if (!bucket) continue;
      bucket.options.push({
        id: Number(op.id),
        group_id: gid,
        name: String(op.name),
        price_delta: Number(op.price_delta ?? 0),
        is_default: Boolean(op.is_default),
        is_available: true,
        sort_order: Number(op.sort_order ?? 0),
      });
    }

    /* ------------------- 4) Attach groups to items --------------------------- */
    const linksByItem = new Map<number, { group_id: number; sort_order: number }[]>();
    for (const l of (links ?? []) as any[]) {
      const lr = l as LinkRow;
      const arr = linksByItem.get(Number(lr.item_id)) ?? [];
      arr.push({ group_id: Number(lr.group_id), sort_order: Number(lr.sort_order ?? 0) });
      linksByItem.set(Number(lr.item_id), arr);
    }

    const payload: ItemOut[] = items.map((i) => {
      const arr = (linksByItem.get(i.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
      const groups = arr.map(({ group_id }) => groupsById.get(group_id)).filter(Boolean) as ModifierGroupOut[];
      return { ...i, groups };
    });

    return res.status(200).json({ ok: true, items: payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return res.status(500).json({ ok: false, error: msg });
  }
}
