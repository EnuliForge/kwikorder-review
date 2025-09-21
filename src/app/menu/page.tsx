"use client";

import { useEffect, useMemo, useState } from "react";
import CartProvider from "../../components/CartProvider";
import MenuItemCard from "../../components/MenuItemCard";
import BottomCartDrawer from "../../components/BottomCartDrawer";
import SearchBar from "../../components/SearchBar";
import type { MenuItem } from "../../lib/types";

function MenuInner() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40">
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
