"use client";

import { useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import type { MenuItem } from "@/lib/types";

function makeUuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const DONENESS = ["well-done", "medium-well", "medium-rare"] as const;
const SIDES = ["Nshima", "Mash Potatoes", "Fries", "Salad"] as const;

export default function MenuItemCard({ item }: { item: MenuItem }) {
  const { add, items: cartItems, inc, dec, remove } = useCart();
  const isRibeye = useMemo(() => /ribeye/i.test(item.name), [item.name]);

  // Find existing line for simple (non-configurable) items
  const existingLine = useMemo(() => {
    if (isRibeye) return null; // ribeye lines are synthetic; controls belong in cart
    return cartItems.find((it) => it.id === item.id) || null;
  }, [cartItems, item.id, isRibeye]);

  // Count ribeye pieces in cart (any variant)
  const ribeyeCount = useMemo(() => {
    if (!isRibeye) return 0;
    return cartItems
      .filter((it) => it.baseId === item.id || /ribeye/i.test(it.name))
      .reduce((s, it) => s + it.qty, 0);
  }, [cartItems, isRibeye, item.id]);

  // Configurator state for Ribeye
  const [open, setOpen] = useState(false);
  const [doneness, setDoneness] =
    useState<(typeof DONENESS)[number] | null>(null);
  const [side, setSide] = useState<string>(""); // optional; empty = no side

  const addPlain = () => {
    add({
      id: item.id, // numeric id merges with same item
      name: item.name,
      price: item.price,
      qty: 1,
      stream: item.stream,
    });
  };

  const addConfiguredRibeye = () => {
    if (!doneness) return; // required
    const syntheticId = `${item.id}-${makeUuid()}`;
    const notes = `Doneness: ${doneness}${side ? ` | Side: ${side}` : ""}`;
    const display = `${item.name} — ${doneness}${side ? ` + ${side}` : ""}`;

    add({
      id: syntheticId,
      baseId: item.id,
      name: display,
      price: item.price,
      qty: 1,
      stream: item.stream,
      notes,
    });

    setOpen(false);
    setDoneness(null);
    setSide("");
  };

  return (
    <li className="rounded-2xl border p-4 bg-white">
      <div className="font-semibold mb-1">{item.name}</div>
      {item.description ? (
        <p className="text-sm text-gray-600 mb-2">{item.description}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="font-semibold">K {item.price.toFixed(2)}</div>

        {/* Action area */}
        {!isRibeye ? (
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
              onClick={() => setOpen(true)}
              title="Configure ribeye"
            >
              Add
            </button>
            {ribeyeCount > 0 && (
              <span className="text-xs rounded-full border px-2 py-1">
                In cart: {ribeyeCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Ribeye modal */}
      {isRibeye && open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <div className="text-lg font-semibold mb-3">
              How do you want your meat cooked?
            </div>

            {/* Doneness (required) */}
            <div className="mb-4">
              <div className="text-sm font-medium mb-2">
                Doneness <span className="text-red-600">*</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {DONENESS.map((d) => (
                  <label
                    key={d}
                    className={`rounded-xl border px-3 py-2 text-sm cursor-pointer select-none text-center ${
                      doneness === d ? "bg-black text-white" : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="doneness"
                      className="hidden"
                      checked={doneness === d}
                      onChange={() => setDoneness(d)}
                    />
                    <span className="capitalize">{d.replace("-", " ")}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Side (optional) — buttons only; tap to toggle off */}
            <div className="mb-4">
              <div className="text-sm font-medium mb-2">Side (optional)</div>
              <div className="grid grid-cols-2 gap-2">
                {SIDES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSide(side === s ? "" : s)}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      side === s ? "bg-black text-white" : "hover:bg-gray-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="rounded-xl border px-3 py-2 text-sm"
                onClick={() => {
                  setOpen(false);
                  setDoneness(null);
                  setSide("");
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                disabled={!doneness}
                onClick={addConfiguredRibeye}
              >
                Add to cart
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
