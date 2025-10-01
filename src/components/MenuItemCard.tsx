// src/components/MenuItemCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import type { MenuItem } from "@/lib/types";

function makeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Local shapes in case your MenuItem type doesn't declare groups */
type ModOption = {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
};
type ModGroup = {
  id: number;
  name: string;
  selection: "single" | "multiple";
  required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: ModOption[];
};
type ItemWithMods = MenuItem & { groups?: ModGroup[] | undefined };

export default function MenuItemCard({ item }: { item: ItemWithMods }) {
  const { add, items: cartItems, inc, dec, remove } = useCart();

  const hasMods = (item.groups?.length ?? 0) > 0;

  // Non-configurable items can merge by numeric id
  const existingLine = useMemo(() => {
    if (hasMods) return null;
    return cartItems.find((it) => it.id === item.id) || null;
  }, [cartItems, item.id, hasMods]);

  // For configurable items, show "In cart" count by baseId
  const inCartCount = useMemo(() => {
    if (!hasMods) return 0;
    return cartItems
      .filter((it) => it.baseId === item.id)
      .reduce((s, it) => s + it.qty, 0);
  }, [cartItems, hasMods, item.id]);

  // --- Modal state (for configurable items)
  const [open, setOpen] = useState(false);
  const [freshItem, setFreshItem] = useState<ItemWithMods | null>(null);
  const [selection, setSelection] = useState<Map<number, number[]>>(new Map()); // groupId -> [optionIds]
  const [loading, setLoading] = useState(false);

  // Open & fetch latest groups/options from API (fallback to prop if API fails)
  async function openConfigurator() {
    setOpen(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/menu/item?id=${item.id}`, { cache: "no-store" });
      const j = await r.json();
      const fresh: ItemWithMods = j?.item ?? item;
      setFreshItem(fresh);
      primeSelectionFromDefaults(fresh);
    } catch {
      setFreshItem(item);
      primeSelectionFromDefaults(item);
    } finally {
      setLoading(false);
    }
  }

  function primeSelectionFromDefaults(it: ItemWithMods) {
    const map = new Map<number, number[]>();
    for (const g of it.groups ?? []) {
      const defaults = (g.options ?? [])
        .filter((o) => o.is_default && o.is_available)
        .map((o) => Number(o.id));
      if (g.selection === "single") {
        map.set(g.id, defaults.length ? [defaults[0]] : []);
      } else {
        map.set(g.id, defaults);
      }
    }
    setSelection(map);
  }

  // Helpers to toggle selection
  function chooseSingle(gid: number, oid: number) {
    const next = new Map(selection);
    next.set(gid, [oid]);
    setSelection(next);
  }
  function toggleMulti(g: ModGroup, oid: number) {
    const cur = selection.get(g.id) ?? [];
    const isChosen = cur.includes(oid);
    let nextArr = cur.slice();
    if (isChosen) {
      nextArr = cur.filter((x) => x !== oid);
    } else {
      if (cur.length >= g.max_select) return; // respect max
      nextArr = cur.concat(oid);
    }
    const next = new Map(selection);
    next.set(g.id, nextArr);
    setSelection(next);
  }

  // Validation & price
  const computed = useMemo(() => {
    if (!freshItem) return { valid: true, addPrice: item.price, summary: "", notes: "" };

    let addDelta = 0;
    const partsForDisplay: string[] = [];
    const partsForNotes: string[] = [];

    for (const g of freshItem.groups ?? []) {
      const chosenIds = selection.get(g.id) ?? [];
      const chosenOpts = g.options.filter((o) => chosenIds.includes(o.id));

      // Validate required / min
      const requiredMin = g.required ? Math.max(1, g.min_select) : g.min_select;
      if (chosenIds.length < requiredMin) {
        return { valid: false, addPrice: item.price, summary: "", notes: "" };
      }

      // Sum price delta and collect text
      if (chosenOpts.length) {
        partsForDisplay.push(chosenOpts.map((o) => o.name).join(" + "));
        partsForNotes.push(`${g.name}: ${chosenOpts.map((o) => o.name).join(", ")}`);
        addDelta += chosenOpts.reduce((s, o) => s + Number(o.price_delta || 0), 0);
      }
    }

    const addPrice = Number(item.price || 0) + addDelta;
    const summary = partsForDisplay.join(" + ");
    const notes = partsForNotes.join(" | ");

    return { valid: true, addPrice, summary, notes };
  }, [freshItem, selection, item.price]);

  // Actions
  const addPlain = () => {
    add({
      id: item.id, // numeric id merges
      name: item.name,
      price: item.price,
      qty: 1,
      stream: item.stream,
    });
  };

  const addConfigured = () => {
    if (!freshItem || !computed.valid) return;
    const syntheticId = `${item.id}-${makeUuid()}`;
    const display = computed.summary
      ? `${item.name} — ${computed.summary}`
      : item.name;

    add({
      id: syntheticId,
      baseId: item.id, // lets us count per base item
      name: display,
      price: computed.addPrice,
      qty: 1,
      stream: item.stream,
      notes: computed.notes, // full breakdown for kitchen
    });

    setOpen(false);
    setFreshItem(null);
    setSelection(new Map());
  };

  return (
    <li className="rounded-2xl border p-4 bg-white">
      <div className="font-semibold mb-1">{item.name}</div>
      {item.description ? (
        <p className="text-sm text-gray-600 mb-2">{item.description}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="font-semibold">K {Number(item.price || 0).toFixed(2)}</div>

        {/* Action area */}
        {!hasMods ? (
          existingLine ? (
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border px-3 py-1 text-sm"
                onClick={() => dec(existingLine.id)}
                title="Decrease"
              >
                −
              </button>
              <span className="min-w-6 text-center font-medium">
                {existingLine.qty}
              </span>
              <button
                className="rounded-lg border px-3 py-1 text-sm"
                onClick={() => inc(existingLine.id)}
                title="Increase"
              >
                +
              </button>
              <button
                className="rounded-lg border px-2 py-1 text-xs"
                onClick={() => remove(existingLine.id)}
                title="Remove from cart"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={addPlain}
            >
              Add
            </button>
          )
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={openConfigurator}
              title="Customize"
            >
              Add
            </button>
            {inCartCount > 0 && (
              <span className="text-xs rounded-full border px-2 py-1">
                In cart: {inCartCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Configurator modal for items with modifiers */}
      {hasMods && open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <div className="text-lg font-semibold mb-1">
              {item.name}
            </div>
            <div className="text-sm text-gray-600 mb-3">
              {loading ? "Loading options…" : null}
            </div>

            {/* Groups */}
            {!loading && freshItem?.groups?.map((g) => {
              const chosenIds = selection.get(g.id) ?? [];
              const chosenCount = chosenIds.length;
              const atMax = chosenCount >= g.max_select;

              return (
                <div key={g.id} className="mb-4">
                  <div className="text-sm font-medium mb-2">
                    {g.name}{" "}
                    {g.required ? <span className="text-red-600">*</span> : null}
                    {g.min_select > 0 || g.max_select > 1 ? (
                      <span className="ml-1 text-xs text-gray-500">
                        {g.selection === "single"
                          ? "(choose 1)"
                          : `(choose ${g.min_select || 0}–${g.max_select})`}
                      </span>
                    ) : null}
                  </div>

                  {g.selection === "single" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {g.options
                        .filter((o) => o.is_available)
                        .map((o) => (
                          <label
                            key={o.id}
                            className={`rounded-xl border px-3 py-2 text-sm cursor-pointer select-none text-center ${
                              chosenIds.includes(o.id)
                                ? "bg-black text-white"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`g-${g.id}`}
                              className="hidden"
                              checked={chosenIds.includes(o.id)}
                              onChange={() => chooseSingle(g.id, o.id)}
                            />
                            <span>
                              {o.name}
                              {Number(o.price_delta || 0) !== 0 ? (
                                <span className="ml-1 text-xs opacity-80">
                                  {Number(o.price_delta) > 0 ? "+" : "−"}K{" "}
                                  {Math.abs(Number(o.price_delta)).toFixed(2)}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {g.options
                        .filter((o) => o.is_available)
                        .map((o) => {
                          const checked = chosenIds.includes(o.id);
                          const disableNew = !checked && atMax;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              disabled={disableNew}
                              onClick={() => toggleMulti(g, o.id)}
                              className={`rounded-xl border px-3 py-2 text-sm ${
                                checked
                                  ? "bg-black text-white"
                                  : disableNew
                                  ? "opacity-50 cursor-not-allowed"
                                  : "hover:bg-gray-50"
                              }`}
                            >
                              {o.name}
                              {Number(o.price_delta || 0) !== 0 ? (
                                <span className="ml-1 text-xs opacity-80">
                                  {Number(o.price_delta) > 0 ? "+" : "−"}K{" "}
                                  {Math.abs(Number(o.price_delta)).toFixed(2)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Footer */}
            <div className="mt-2 flex items-center justify-between">
              <div className="text-sm">
                Total:{" "}
                <span className="font-semibold">
                  K {Number(computed.addPrice || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-xl border px-3 py-2 text-sm"
                  onClick={() => {
                    setOpen(false);
                    setFreshItem(null);
                    setSelection(new Map());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                  disabled={loading || !computed.valid}
                  onClick={addConfigured}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
