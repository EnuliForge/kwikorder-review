// src/components/BottomCartDrawer.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";

type CartLine = {
  id: string | number;
  baseId?: string | number;
  name: string;
  price: number;
  qty: number;
  stream: "food" | "drinks";
  notes?: string | null;
};

const isDigits = (v: any) =>
  (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
  (typeof v === "string" && /^\d+$/.test(v));

export default function BottomCartDrawer() {
  const router = useRouter();
  const { items, inc, dec, clear } = useCart();

  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // Collapsible state (persist)
  const [collapsed, setCollapsed] = useState<boolean>(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kwik.cart.collapsed");
      if (saved != null) setCollapsed(saved === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("kwik.cart.collapsed", collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0),
    [items]
  );
  const totalQty = useMemo(
    () => items.reduce((s, it) => s + Number(it.qty || 0), 0),
    [items]
  );

  useEffect(() => {
    if (items.length === 0) setBanner(null);
  }, [items.length]);

  async function validateAvailability(): Promise<string[]> {
    const uniqueChecks: Array<{ idForCheck: string; display: string }> = [];
    for (const it of items as CartLine[]) {
      const idForCheck = isDigits(it.id) ? String(it.id)
        : isDigits(it.baseId) ? String(it.baseId)
        : "";
      if (!idForCheck) continue;
      if (!uniqueChecks.some((u) => u.idForCheck === idForCheck)) {
        uniqueChecks.push({ idForCheck, display: it.name });
      }
    }
    const unavailable: string[] = [];
    await Promise.all(
      uniqueChecks.map(async ({ idForCheck, display }) => {
        try {
          const r = await fetch(`/api/menu/item?id=${encodeURIComponent(idForCheck)}`, { cache: "no-store" });
          if (!r.ok) { unavailable.push(display); return; }
          const j = await r.json().catch(() => null);
          if (!j?.ok) unavailable.push(display);
        } catch {}
      })
    );
    return unavailable;
  }

  async function proceed() {
    try {
      setSubmitting(true);
      setBanner(null);

      const tableStr = (typeof window !== "undefined" && localStorage.getItem("kwik.table")) || "";
      const tableNum = Number(tableStr);
      if (!Number.isFinite(tableNum) || tableNum <= 0) {
        setBanner("No table number set. Go to Start and pick your table first.");
        setSubmitting(false);
        return;
      }

      const unavailable = await validateAvailability();
      if (unavailable.length > 0) {
        setBanner(`Unavailable: ${unavailable.join(", ")}. Please refresh the menu or remove those items.`);
        setSubmitting(false);
        return;
      }

      const payloadItems = (items as CartLine[]).map((it) => ({
        id: isDigits(it.id) ? String(it.id) : isDigits(it.baseId) ? String(it.baseId) : "",
        baseId: isDigits(it.baseId) ? String(it.baseId) : undefined,
        name: it.name,
        price: Number(it.price || 0),
        qty: Number(it.qty || 0),
        stream: it.stream === "drinks" ? "drinks" : "food",
        notes: it.notes ?? null,
      }));

      const resp = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_number: tableNum, items: payloadItems }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j?.error || "Failed to create order");

      clear();
      router.replace(`/status/table/${tableNum}`);
    } catch (e: any) {
      setBanner(e?.message || "Something went wrong while placing your order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (items.length === 0) return null;

  const GreenBar = ({ top = false }: { top?: boolean }) => (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      className={`w-full ${top ? "rounded-xl" : "rounded-t-xl"} bg-emerald-600 text-white px-4 py-3 shadow flex items-center justify-between`}
      aria-expanded={!collapsed}
      aria-controls="cart-drawer"
      title={collapsed ? "Expand cart" : "Collapse cart"}
    >
      <div className="font-semibold">
        Cart <span className="opacity-90">({totalQty})</span>
      </div>
      <div className="font-semibold">K {subtotal.toFixed(2)} {collapsed ? "▲" : "▼"}</div>
    </button>
  );

  // COLLAPSED — now centered and same width as expanded (max-w-4xl)
  if (collapsed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto max-w-4xl w-full px-4 pb-3">
          <GreenBar />
        </div>
      </div>
    );
  }

  // EXPANDED
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-4xl px-4 py-3" id="cart-drawer">
        <div className="mb-3">
          <GreenBar top />
        </div>

        {banner && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
            {banner} <a href="/start" className="underline">Go to Start</a>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold">Your cart</div>
          <div className="text-lg font-semibold">K {subtotal.toFixed(2)}</div>
        </div>

        <ul className="mt-2 max-h-64 overflow-auto divide-y">
          {items.map((it) => (
            <li key={String(it.id)} className="py-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.name}</div>
                  <div className="text-xs text-gray-500 capitalize">{it.stream}</div>
                  {it.notes ? <div className="text-xs text-gray-500 mt-1">{it.notes}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded-lg border px-3 py-1" onClick={() => dec(it.id)} aria-label={`Decrease ${it.name}`}>−</button>
                  <span className="min-w-6 text-center font-medium">{it.qty}</span>
                  <button className="rounded-lg border px-3 py-1" onClick={() => inc(it.id)} aria-label={`Increase ${it.name}`}>+</button>
                  <div className="w-20 text-right font-medium">
                    K {(Number(it.price || 0) * Number(it.qty || 0)).toFixed(2)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between">
          <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => clear()}>
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setCollapsed(true)} title="Collapse cart">
              Collapse
            </button>
            <button
              className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
              disabled={submitting}
              onClick={proceed}
            >
              {submitting ? "Placing…" : "Proceed"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
