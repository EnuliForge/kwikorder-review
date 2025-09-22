"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Status = "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";
type Ticket = {
  id: number;
  status: Status;
  created_at: string | null;
  ready_at: string | null;
  order_code: string;
  table_number: number | null;
  items: { name: string; qty: number }[];
};

const ALLOWED_NEXT: Record<Status, Status[]> = {
  received:   ["preparing", "cancelled"],
  preparing:  ["ready", "cancelled"],
  ready:      ["cancelled"], // Kitchen doesn't deliver; runner does
  delivered:  [],
  cancelled:  [],
  completed:  [],
};

function Badge({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    delivered: "bg-emerald-100 text-emerald-800",
    ready: "bg-amber-100 text-amber-800",
    preparing: "bg-sky-100 text-sky-800",
    received: "bg-gray-100 text-gray-700",
    cancelled: "bg-red-100 text-red-800",
    completed: "bg-emerald-100 text-emerald-800",
  };
  return <span className={`px-3 py-1 rounded-full text-sm capitalize ${map[status]}`}>{status}</span>;
}

export default function KitchenKDS() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      setErr(null);
      const r = await fetch(`/api/kds/list?stream=food`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed to load");
      setTickets(j.tickets ?? []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 4000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const startPreparing = async (t: Ticket) => {
    if (!ALLOWED_NEXT[t.status].includes("preparing")) return;
    setBusyId(t.id);
    try {
      const res = await fetch("/api/tickets/update-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_code: t.order_code, stream: "food", next_status: "preparing" }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Update failed");
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  const markReady = async (t: Ticket) => {
    if (!ALLOWED_NEXT[t.status].includes("ready")) return;
    setBusyId(t.id);
    try {
      const res = await fetch("/api/tickets/update-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_code: t.order_code, stream: "food", next_status: "ready" }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Update failed");
      await load();
    } catch (e: any) {
      alert(e?.message || "Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  // Optional sort: status then created_at
  const grouped = useMemo(() => {
    const ord: Record<Status, number> = { received: 0, preparing: 1, ready: 2, cancelled: 3, delivered: 4, completed: 5 };
    return [...tickets].sort((a, b) => {
      const s = ord[a.status] - ord[b.status];
      if (s !== 0) return s;
      return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
    });
  }, [tickets]);

  return (
    <main className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Kitchen</h1>
        <div className="text-sm text-gray-600">Stream: <span className="font-semibold">Food</span></div>
      </header>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((t) => (
            <article key={t.id} className="rounded-2xl border bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-xl font-extrabold">Table {t.table_number ?? "—"}</div>
                  <div className="text-xs text-gray-500">#{t.order_code}</div>
                </div>
                <Badge status={t.status} />
              </div>

              {/* Items list — large & readable */}
              <ul className="mt-2 space-y-1">
                {t.items.length ? (
                  t.items.map((li, i) => (
                    <li key={i} className="flex items-center justify-between text-base">
                      <span className="truncate">{li.name}</span>
                      <span className="font-semibold">×{li.qty}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-gray-500">No items.</li>
                )}
              </ul>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => startPreparing(t)}
                  disabled={busyId === t.id || !ALLOWED_NEXT[t.status].includes("preparing")}
                  className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
                  title="Move to preparing"
                >
                  {busyId === t.id && ALLOWED_NEXT[t.status].includes("preparing") ? "Updating…" : "Start preparing"}
                </button>
                <button
                  onClick={() => markReady(t)}
                  disabled={busyId === t.id || !ALLOWED_NEXT[t.status].includes("ready")}
                  className="rounded-xl bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                  title="Mark ready"
                >
                  {busyId === t.id && ALLOWED_NEXT[t.status].includes("ready") ? "Updating…" : "Mark ready"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
