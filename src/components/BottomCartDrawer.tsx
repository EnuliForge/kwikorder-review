"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";

export default function BottomCartDrawer() {
  const { items, total, inc, dec, clear } = useCart();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (items.length === 0) return null;

  const placeOrder = async () => {
    try {
      setBusy(true);
      setError(null);

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Replace with a real table number once you have it from QR scan / landing page
          table_number: null,
          items: items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            qty: i.qty,
            stream: i.stream, // "food" | "drinks" — used for ticket split server-side
          })),
        }),
      });

      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Order failed");
      // Optional: clear local cart once order is accepted
      clear();
      // Navigate to the live status page
      router.push(`/status/${encodeURIComponent(j.order_code)}`);
    } catch (e: any) {
      setError(e?.message || "Failed to place order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 p-3">
      <div
        className={`mx-auto max-w-3xl rounded-2xl shadow-lg transition-colors ${
          open ? "bg-white border" : "bg-emerald-700 text-white"
        }`}
      >
        {/* Toggle header */}
        <button
          className="w-full flex items-center justify-between px-4 py-3"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="font-semibold">
            {open ? "Your cart" : `${items.length} item(s) in cart`}
          </span>
          <span className="font-bold">{`K ${total.toFixed(2)}`}</span>
        </button>

        {open && (
          <div className="p-3">
            {/* Error banner */}
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                {error}
              </div>
            )}

            {/* Lines */}
            <div className="divide-y">
              {items.map((it) => (
                <div
                  key={String(it.id)}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-gray-500">
                      {it.stream === "drinks" ? "Drinks" : "Food"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-1 rounded-lg border"
                      onClick={() => dec(it.id)}
                      disabled={busy}
                    >
                      -
                    </button>
                    <span className="min-w-6 text-center">{it.qty}</span>
                    <button
                      className="px-3 py-1 rounded-lg border"
                      onClick={() => inc(it.id)}
                      disabled={busy}
                    >
                      +
                    </button>
                    <div className="w-20 text-right font-semibold">
                      K {(it.qty * it.price).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals + actions */}
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Subtotal: <span className="font-semibold">K {total.toFixed(2)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-xl border px-3 py-2"
                  onClick={() => clear()}
                  disabled={busy}
                  title="Empty cart"
                >
                  Clear
                </button>
                <button
                  className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-60"
                  disabled={busy || items.length === 0}
                  onClick={placeOrder}
                >
                  {busy ? "Placing…" : "Proceed"}
                </button>
              </div>
            </div>

            {/* Optional: note about split delivery */}
            <p className="mt-2 text-xs text-gray-500">
              Orders are split into Food & Drinks so items can be delivered as soon as they’re ready.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
