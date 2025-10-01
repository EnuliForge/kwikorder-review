"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: number;
  name: string;
  price: number;
  stream: "food" | "drinks" | null;
  hidden: boolean;
  is_available: boolean;
  updated_at: string | null;
};

export default function AdminMenuPage() {
  const [q, setQ] = useState("");
  const [stream, setStream] = useState<"" | "all" | "food" | "drinks">("all");
  const [includeHidden, setIncludeHidden] = useState(true);
  const [includeUnavailable, setIncludeUnavailable] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<number[]>([]);

  async function load() {
    try {
      setErr(null);
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (stream) params.set("stream", stream);
      params.set("include_hidden", String(includeHidden));
      params.set("include_unavailable", String(includeUnavailable));

      const r = await fetch(`/api/admin/menu/list?${params.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || "Failed to load menu");
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => items, [items]); // server is already filtering

  async function updateItem(id: number, patch: Partial<Pick<Item, "hidden" | "is_available">>) {
    try {
      setBusyIds((s) => [...s, id]);
      const r = await fetch("/api/admin/menu/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || "Update failed");
      await load();
    } catch (e: any) {
      alert(e?.message || "Update failed");
    } finally {
      setBusyIds((s) => s.filter((x) => x !== id));
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin • Menu</h1>
        <div className="flex gap-2">
          <a href="/admin" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Back to Admin</a>
        </div>
      </header>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          className="rounded-lg border px-3 py-2 text-sm"
          placeholder="Search name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <select
          className="rounded-lg border px-3 py-2 text-sm"
          value={stream}
          onChange={(e) => setStream(e.target.value as any)}
        >
          <option value="all">All streams</option>
          <option value="food">Food</option>
          <option value="drinks">Drinks</option>
        </select>
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
            />
            Include hidden
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeUnavailable}
              onChange={(e) => setIncludeUnavailable(e.target.checked)}
            />
            Include 86’d
          </label>
          <button
            onClick={load}
            className="ml-auto rounded-lg border px-3 py-1 hover:bg-gray-50"
          >
            Apply
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-2">
          <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
          <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
          <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">No matching items.</div>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((it) => {
            const isBusy = busyIds.includes(it.id);
            const color =
              it.hidden
                ? "bg-gray-50 border-gray-300 text-gray-700"
                : !it.is_available
                ? "bg-red-50 border-red-300 text-red-900"
                : "bg-white";
            return (
              <li key={it.id} className={`rounded-xl border p-3 ${color}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    <span className="capitalize">{it.stream ?? "—"}</span>
                    {" • "}
                    {it.name}
                    <span className="ml-2 text-gray-600 font-normal">K {it.price.toFixed(2)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => updateItem(it.id, { is_available: !it.is_available })}
                      className="rounded-lg border px-3 py-1 text-sm disabled:opacity-60"
                      title={it.is_available ? "86 (mark unavailable)" : "Un-86 (mark available)"}
                    >
                      {isBusy ? "Working…" : (it.is_available ? "86" : "Un-86")}
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => updateItem(it.id, { hidden: !it.hidden })}
                      className="rounded-lg border px-3 py-1 text-sm disabled:opacity-60"
                      title={it.hidden ? "Unhide" : "Hide"}
                    >
                      {isBusy ? "Working…" : (it.hidden ? "Unhide" : "Hide")}
                    </button>
                  </div>
                </div>
                {it.hidden && <div className="text-xs mt-1 text-gray-600">Hidden</div>}
                {!it.is_available && <div className="text-xs mt-1 text-red-700">86’d / Unavailable</div>}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
