// src/app/menu/page.tsx
"use client";
export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import CartProvider, { useCart } from "../../components/CartProvider";
import MenuItemCard from "../../components/MenuItemCard";
import BottomCartDrawer from "../../components/BottomCartDrawer";
import SearchBar from "../../components/SearchBar";
import type { MenuItem } from "../../lib/types";

type Section = { key: string; title: string; items: MenuItem[] };

function MenuInner() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();

  // table number
  const [table, setTable] = useState<number | null>(null);
  useEffect(() => {
    let resolved: number | null = null;
    const fromUrl = searchParams.get("table") || searchParams.get("t");
    if (fromUrl) {
      const n = parseInt(fromUrl, 10);
      if (Number.isFinite(n) && n > 0) {
        resolved = n;
        try { localStorage.setItem("kwik.table", String(n)); } catch {}
      }
    }
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

  // load+refresh
  useEffect(() => {
    let alive = true;
    let first = true;
    const load = async () => {
      try {
        if (first) setLoading(true);
        const r = await fetch("/api/menu?stream=all", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setItems(j.items ?? []);
      } catch {} finally {
        if (!alive) return;
        if (first) {
          setLoading(false);
          first = false;
        }
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, []);

  // idle auto-return (15m) if cart empty
  const { items: cartItems } = useCart();
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    const bump = () => { lastActiveRef.current = Date.now(); };
    const evs: (keyof WindowEventMap)[] = ["click", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump));
    const t = setInterval(() => {
      const idleMs = Date.now() - lastActiveRef.current;
      const canLeave = cartItems.length === 0;
      if (canLeave && idleMs >= 15 * 60 * 1000) {
        try { localStorage.removeItem("kwik.table"); } catch {}
        router.replace("/start");
      }
    }, 60 * 1000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [cartItems.length, router]);

  // change table
  const changeTable = () => {
    const input = prompt("Enter table number");
    if (!input) return;
    const n = parseInt(input, 10);
    if (!Number.isFinite(n) || n <= 0) return alert("Invalid table number");
    setTable(n);
    try { localStorage.setItem("kwik.table", String(n)); } catch {}
    router.replace(`/menu?table=${n}`);
  };

  // filter + group
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) =>
      [it.name, it.description, it.category]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [items, q]);

  const sections: Section[] = useMemo(() => {
    const bucket = new Map<string, Section>();
    const titleFor = (stream: string | null | undefined, category: string | null | undefined) => {
      const sTitle = stream === "drinks" ? "Drinks" : "Food";
      return category ? `${sTitle} — ${category}` : sTitle;
    };
    for (const it of filtered) {
      const key = `${it.stream || "food"}::${it.category || ""}`;
      if (!bucket.has(key)) {
        bucket.set(key, { key, title: titleFor(it.stream as any, it.category as any), items: [] });
      }
      bucket.get(key)!.items.push(it);
    }
    const arr = Array.from(bucket.values());
    arr.sort((a, b) => {
      const sA = a.title.startsWith("Food") ? 0 : 1;
      const sB = b.title.startsWith("Food") ? 0 : 1;
      if (sA !== sB) return sA - sB;
      return a.title.localeCompare(b.title);
    });
    for (const sec of arr) {
      sec.items.sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return so !== 0 ? so : a.name.localeCompare(b.name);
      });
    }
    return arr;
  }, [filtered]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-40">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Menu</h1>
          <div className="rounded-full border px-3 py-1 text-sm">
            {table != null ? <>Table <span className="font-semibold">{table}</span></> : <span className="text-gray-500">No table set</span>}
          </div>
          <button type="button" className="text-xs rounded-md border px-2 py-1 hover:bg-gray-50" onClick={changeTable}>
            Change
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => location.reload()} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" title="Hard refresh menu">
            Refresh
          </button>
          <button type="button" onClick={() => { try { localStorage.removeItem("kwik.table"); } catch {}; router.replace("/start"); }} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" title="Clear table and return to start">
            End session
          </button>
        </div>
      </header>

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

      {loading ? (
        <ul className="grid list-none p-0 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-40 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </ul>
      ) : sections.length === 0 ? (
        <div className="mt-6 text-sm text-gray-600">No matching items.</div>
      ) : (
        <div className="mt-2 space-y-8">
          {sections.map((sec) => (
            <section key={sec.key}>
              <h2 className="mb-2 text-lg font-semibold">{sec.title}</h2>
              <ul className="grid list-none p-0 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sec.items.map((it) => (
                  <MenuItemCard key={String(it.id)} item={it} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

export default function MenuPage() {
  return (
    <CartProvider>
      <Suspense fallback={<main className="mx-auto max-w-6xl px-4 pb-40">Loading…</main>}>
        {/* Everything that might call useSearchParams goes inside Suspense */}
        <MenuInner />
        <BottomCartDrawer />
      </Suspense>
    </CartProvider>
  );
}
