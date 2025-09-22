// src/app/menu/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CartProvider from "../../components/CartProvider";
import MenuItemCard from "../../components/MenuItemCard";
import BottomCartDrawer from "../../components/BottomCartDrawer";
import SearchBar from "../../components/SearchBar";
import type { MenuItem } from "../../lib/types";

function MenuInner() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  // Read table from URL (?table=12 or ?t=12) then persist to localStorage.
  // Fallback to localStorage if no URL param.
  const searchParams = useSearchParams();
  const [table, setTable] = useState<number | null>(null);

  useEffect(() => {
    let resolved: number | null = null;

    // 1) URL param
    const fromUrl = searchParams.get("table") || searchParams.get("t");
    if (fromUrl) {
      const n = parseInt(fromUrl, 10);
      if (Number.isFinite(n) && n > 0) {
        resolved = n;
        try { localStorage.setItem("kwik.table", String(n)); } catch {}
      }
    }

    // 2) localStorage fallback
    if (resolved === null) {
      try {
        const t = localStorage.getItem("kwik.table");
        if (t) {
          const n = parseInt(t, 10);
          if (Number.isFinite(n) && n > 0) resolved = n;
        }
      } catch {}
    }

    setTable(resolved);
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await fetch("/api/menu", { cache: "no-store" });
      const j = await r.json();
      setItems(j.items ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) =>
      [it.name, it.description].filter(Boolean).some((v) => (v || "").toLowerCase().includes(s))
    );
  }, [items, q]);

  // (Optional) quick way to change table from here if needed
  const changeTable = () => {
    const input = prompt("Enter table number");
    if (!input) return;
    const n = parseInt(input, 10);
    if (!Number.isFinite(n) || n <= 0) return alert("Invalid table number");
    setTable(n);
    try { localStorage.setItem("kwik.table", String(n)); } catch {}
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40">
      {/* Header with table badge */}
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Menu</h1>
        <div className="flex items-center gap-2">
          <div className="rounded-full border px-3 py-1 text-sm">
            {table != null ? (
              <>Table <span className="font-semibold">{table}</span></>
            ) : (
              <span className="text-gray-500">No table set</span>
            )}
          </div>
          <button
            type="button"
            className="text-xs rounded-md border px-2 py-1 hover:bg-gray-50"
            onClick={changeTable}
            title="Change table"
          >
            Change
          </button>
        </div>
      </header>

      {/* Gentle banner so it's obvious */}
      {table != null ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
          Ordering for <strong>Table {table}</strong>.
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          Set your table number on the start page before placing an order.
        </div>
      )}

      <SearchBar value={q} onChange={setQ} />
      <ul className="grid list-none p-0 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-40 rounded-2xl bg-gray-100 animate-pulse" />
            ))
          : filtered.map((it) => <MenuItemCard key={String(it.id)} item={it} />)}
      </ul>
    </main>
  );
}

export default function MenuPage() {
  return (
    <CartProvider>
      <MenuInner />
      <BottomCartDrawer />
    </CartProvider>
  );
}
