"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Ticket = {
  id: number;
  order_group_id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";
  created_at: string;
};

function makeSupa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function BarKDS() {
  const supa = useMemo(makeSupa, []);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: number; action: "preparing" | "ready" } | null>(null);

  async function load() {
    setErr(null);
    const { data, error } = await supa
      .from("tickets")
      .select("id, order_group_id, stream, status, created_at")
      .eq("stream", "drinks")
      .in("status", ["received", "preparing"])
      .order("created_at", { ascending: true });
    if (error) setErr(error.message);
    else setTickets((data || []) as Ticket[]);
  }

  useEffect(() => {
    load();
    const ch = supa
      .channel("kds_bar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: "stream=eq.drinks" },
        () => load()
      )
      .subscribe();
    return () => { supa.removeChannel(ch); };
  }, [supa]);

  async function setStatus(id: number, next: "preparing" | "ready") {
    const prev = tickets;
    setBusy({ id, action: next });
    setTickets(prev.map(t => (t.id === id ? { ...t, status: next } : t)));

    try {
      const r = await fetch("/api/tickets/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket_id: id, status: next }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e: any) {
      setTickets(prev);
      setErr(e?.message || "Failed to update");
    } finally {
      setBusy(null);
      load();
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold mb-4">KDS — Bar</h1>
      {err && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      <div className="grid gap-3">
        {tickets.length === 0 && (
          <div className="rounded-xl border p-4 text-sm text-gray-600">No bar tickets waiting.</div>
        )}

        {tickets.map((t) => {
          const isBusy = busy?.id === t.id;
          const starting = isBusy && busy?.action === "preparing";
          const readying = isBusy && busy?.action === "ready";

          return (
            <div key={t.id} className="rounded-xl border p-4 bg-white">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Ticket #{String(t.id).slice(-4)}</div>
                <div className="text-xs rounded-full border px-2 py-1 capitalize">{t.status}</div>
              </div>

              <div className="mt-3 flex gap-2">
                {t.status === "received" && (
                  <button
                    onClick={() => setStatus(t.id, "preparing")}
                    disabled={isBusy}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {starting ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> Starting…
                      </span>
                    ) : (
                      "Start preparing"
                    )}
                  </button>
                )}

                {(t.status === "received" || t.status === "preparing") && (
                  <button
                    onClick={() => setStatus(t.id, "ready")}
                    disabled={isBusy}
                    className="rounded-lg border bg-black text-white px-3 py-2 text-sm hover:opacity-90 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {readying ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> Marking ready…
                      </span>
                    ) : (
                      "Mark ready"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
