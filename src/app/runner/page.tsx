// src/app/runner/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Stream = "food" | "drinks";
type TicketStatus = "ready" | "received" | "preparing" | "cancelled" | "delivered" | "completed";

/** Tickets to deliver (from runner_queue view) */
type DeliverRow = {
  kind: "deliver";
  ticket_id: number;
  issue_id: null;
  order_code: string;
  table_number: number | null;
  stream: Stream;
  status: TicketStatus;
  ready_at: string | null;
  created_at: string | null; // not used for deliver, set null
};

/** Open issues needing runner action */
type IssueRow = {
  kind: "issue";
  ticket_id: number | null; // may be null (order-wide or stream-level issue)
  issue_id: number;
  order_code: string;
  table_number: number | null;
  stream: Stream | null; // null = order-wide
  status: null;
  ready_at: null;
  issue_type: string | null;
  issue_status: "open" | "runner_ack" | "client_ack" | "resolved";
  created_at: string | null;
};

type Row = DeliverRow | IssueRow;

export default function RunnerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      setErr(null);
      const r = await fetch("/api/runner/queue", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || "Failed to load runner queue");
      setRows(Array.isArray(j.rows) ? (j.rows as Row[]) : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load runner queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 4000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  async function markDelivered(row: DeliverRow) {
    try {
      setBusyIds((s) => [...s, row.ticket_id]);
      const resp = await fetch("/api/runner/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_code: row.order_code,
          ticket_id: row.ticket_id,
        }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j?.error || "Failed to mark delivered");
      showToast("ok", `Marked delivered: ${row.stream} • ${row.order_code}`);
      await load();
    } catch (e: any) {
      showToast("err", e?.message || "Failed to mark delivered");
    } finally {
      setBusyIds((s) => s.filter((id) => id !== row.ticket_id));
    }
  }

  async function runnerBroughtFix(row: IssueRow) {
    try {
      // use ticket if available; else fall back to stream or order-wide
      const payload: any = {
        order_code: row.order_code,
        mode: "runner_ack",
        description: row.issue_type ? `Fix for ${row.issue_type}` : null,
      };
      if (row.ticket_id) payload.ticket_id = row.ticket_id;
      else if (row.stream) payload.stream = row.stream;
      else payload.order_wide = true;

      const busyKey = row.ticket_id ?? -row.issue_id;
      setBusyIds((s) => [...s, busyKey]);

      const resp = await fetch("/api/issues/runner-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j?.error || "Failed to record fix");

      showToast("ok", `Fix recorded • ${row.order_code}`);
      await load();
    } catch (e: any) {
      showToast("err", e?.message || "Failed to record fix");
    } finally {
      setBusyIds((s) => s.filter((id) => id !== (row.ticket_id ?? -row.issue_id)));
    }
  }

  const sorted = useMemo(() => {
    // Show newest issues first, then ready tickets by ready_at asc
    const issues = rows.filter((r): r is IssueRow => r.kind === "issue");
    const delivers = rows.filter((r): r is DeliverRow => r.kind === "deliver");

    issues.sort(
      (a, b) =>
        (new Date(b.created_at ?? 0).getTime() || 0) -
        (new Date(a.created_at ?? 0).getTime() || 0)
    );
    delivers.sort((a, b) => {
      const ta = a.ready_at ? new Date(a.ready_at).getTime() : 0;
      const tb = b.ready_at ? new Date(b.ready_at).getTime() : 0;
      return ta - tb || a.ticket_id - b.ticket_id;
    });

    return [...issues, ...delivers];
  }, [rows]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Runner Tasks</h1>
        <button
          onClick={load}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {toast && (
        <div
          className={`mb-3 rounded-lg border p-3 text-sm ${
            toast.type === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3">
          <div className="h-20 rounded-xl bg-gray-100 animate-pulse" />
          <div className="h-20 rounded-xl bg-gray-100 animate-pulse" />
          <div className="h-20 rounded-xl bg-gray-100 animate-pulse" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border bg-white p-4 text-gray-600">No tasks yet.</div>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((row, idx) => {
            const busyKey =
              row.kind === "deliver" ? row.ticket_id : row.ticket_id ?? -row.issue_id;
            const isBusy = busyIds.includes(busyKey);

            const headerLeft =
              row.kind === "deliver"
                ? `Table ${row.table_number ?? "—"} • ${row.stream.toUpperCase()}`
                : `Issue • ${row.stream ? row.stream.toUpperCase() : "ORDER"}`;

            const sub =
              row.kind === "deliver"
                ? `Status: ${row.status}${
                    row.ready_at ? ` (ready ${new Date(row.ready_at).toLocaleTimeString()})` : ""
                  }`
                : `${row.issue_type ?? "Issue"}${
                    row.created_at ? ` • reported ${new Date(row.created_at).toLocaleTimeString()}` : ""
                  }`;

            return (
              <li key={`${row.kind}-${idx}-${busyKey}`} className="rounded-2xl border bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">{headerLeft}</div>
                  <div className="text-sm text-gray-600">{row.order_code}</div>
                </div>

                <div className="mt-1 text-sm text-gray-700">{sub}</div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {row.kind === "deliver" ? (
                    <button
                      disabled={isBusy}
                      onClick={() => markDelivered(row)}
                      className="rounded-lg bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
                    >
                      {isBusy ? "Working…" : "Mark delivered"}
                    </button>
                  ) : (
                    <button
                      disabled={isBusy}
                      onClick={() => runnerBroughtFix(row)}
                      className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                    >
                      Brought a fix
                    </button>
                  )}

                  <a
                    href={`/status/${encodeURIComponent(row.order_code)}`}
                    className="ml-auto rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Status
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
