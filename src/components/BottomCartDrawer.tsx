"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";

export default function BottomCartDrawer() {
  const { items, total, inc, dec, clear } = useCart();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      const t = localStorage.getItem("kwik.table");
      setTable(t ? parseInt(t, 10) : null);
    } catch {
      setTable(null);
    }
  }, []);

  if (items.length === 0) return null;

  const placeOrder = async () => {
    try {
      setBusy(true);
      setError(null);

      if (!table || !Number.isFinite(table) || table <= 0) {
        throw new Error("Please set your table number on the start page before placing an order.");
      }

      const payload = {
        table_number: table,
        items: items.map((i) => ({
          // IMPORTANT: only send a numeric id for DB (or null)
          id: typeof i.baseId === "number" ? i.baseId : null,
          name: i.name,
          price: i.price,
          qty: i.qty,
          stream: i.stream,
          notes: i.notes ?? null, // server can ignore if not used
        })),
      };

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Order failed");

      clear();
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

            {/* Table badge */}
            <div className="mb-2 text-sm">
              Table:{" "}
              <span className="font-semibold">
                {table ?? "— (set on start page)"}
              </span>
            </div>

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
                      {it.notes ? (
                        <>
                          {" "}
                          • <span className="italic">{it.notes}</span>
                        </>
                      ) : null}
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
                Subtotal:{" "}
                <span className="font-semibold">K {total.toFixed(2)}</span>
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

            {/* Note */}
            <p className="mt-2 text-xs text-gray-500">
              Orders are split into Food & Drinks so items can be delivered as soon as they’re ready.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
