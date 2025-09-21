"use client";

import { useCart } from "./CartProvider";
import type { MenuItem } from "../lib/types";

export default function MenuItemCard({ item }: { item: MenuItem }) {
  const { items, add, inc, dec, remove } = useCart(); // ⬅️ include remove
  const line = items.find((x) => x.id === item.id);

  return (
    <li className="rounded-2xl border overflow-hidden bg-white">
      {item.image_url && (
        <img src={item.image_url} alt={item.name} className="w-full h-40 object-cover" />
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{item.name}</div>
            {item.description && (
              <div className="text-sm text-gray-600 line-clamp-2">{item.description}</div>
            )}
            <div className="mt-1 text-xs uppercase tracking-wide">
              <span className={item.stream === "drinks" ? "text-sky-700" : "text-emerald-700"}>
                {item.stream}
              </span>
            </div>
          </div>
          <div className="text-lg font-bold text-emerald-700">
            K {Number(item.price).toFixed(2)}
          </div>
        </div>

        {!line ? (
          <button
            className="mt-3 w-full rounded-xl bg-emerald-600 text-white py-2"
            onClick={() =>
              add({ id: item.id, name: item.name, price: item.price, stream: item.stream })
            }
          >
            Add
          </button>
        ) : (
          <div className="mt-3 flex items-center justify-between">
            <div className="inline-flex items-center rounded-xl border">
              <button className="px-3 py-2" onClick={() => dec(item.id)}>
                -
              </button>
              <span className="px-4">{line.qty}</span>
              <button className="px-3 py-2" onClick={() => inc(item.id)}>
                +
              </button>
            </div>
            <button
              className="rounded-xl bg-red-600 text-white px-4 py-2" // ⬅️ clearer destructive color
              onClick={() => remove(item.id)}                        // ⬅️ remove entire line
              title="Remove from cart"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
