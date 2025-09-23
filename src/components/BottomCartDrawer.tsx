// src/components/BottomCartDrawer.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";

function getTableFromStorage(): number | null {
  try {
    const raw = localStorage.getItem("kwik.table");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export default function BottomCartDrawer() {
  const { items, total, inc, dec, clear } = useCart();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (items.length === 0) return null;

  const placeOrder = async () => {
    const table_number = getTableFromStorage();

    // ⛔️ Hard-stop if table isn't set
    if (table_number == null) {
      setOpen(true);
      setError("Please set your table number first (Start → enter table).");
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          table_number,
          items: items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            qty: i.qty,
            stream: i.stream,
            notes: (i as any).notes ?? null,
          })),
        }),
      });

      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Order failed");

      clear();

      // prefer the table-based status view so multiple orders stack
      router.push(`/status/table/${table_number}`);
    } catch (e: any) {
      setError(e?.message || "Failed to place order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 p-3">
      {/* Always-emerald header to avoid flicker */}
      <div className="mx-auto max-w-3xl rounded-2xl shadow-lg bg-emerald-700 text-white">
        <button
          className="w-full flex items-center justify-between px-4 py-3"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="font-semibold">
            {open ? "Your cart" : `${items.length} item(s) in cart`}
          </span>
          <span className="font-bold">{`K ${total.toFixed(2)}`}</span>
        </button>

        {/* Slide-down panel (no color jump) */}
        <div
          className="overflow-hidden transition-[max-height] duration-300 ease-out bg-white text-black rounded-b-2xl"
          style={{ maxHeight: open ? 560 : 0 }}
        >
          <div className="p-3">
            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                {error}{" "}
                <a
                  href="/start"
                  className="underline ml-1"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push("/start");
                  }}
                >
                  Go to Start
                </a>
              </div>
            )}

            <div className="divide-y">
              {items.map((it) => (
                <div key={String(it.id)} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-gray-500">
                      {it.stream === "drinks" ? "Drinks" : "Food"}
                    </div>
                    {(it as any).notes ? (
                      <div className="text-xs text-gray-600 mt-1">{(it as any).notes}</div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1 rounded-lg border" onClick={() => dec(it.id)} disabled={busy}>
                      -
                    </button>
                    <span className="min-w-6 text-center">{it.qty}</span>
                    <button className="px-3 py-1 rounded-lg border" onClick={() => inc(it.id)} disabled={busy}>
                      +
                    </button>
                    <div className="w-20 text-right font-semibold">K {(it.qty * it.price).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Subtotal: <span className="font-semibold">K {total.toFixed(2)}</span>
              </div>
              <div className="flex gap-2">
                <button className="rounded-xl border px-3 py-2" onClick={() => clear()} disabled={busy}>
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

            <p className="mt-2 text-xs text-gray-500">
              Orders are split into Food & Drinks so items can be delivered as soon as they’re ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
