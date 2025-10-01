// src/app/admin/tables/[table]/report/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type Stream = "food" | "drinks" | null;

type ReportJSON = {
  ok: boolean;
  table: number;
  range: { from: string; to: string; days: number };
  totals: { orders: number; items: number; revenue: number };
  orders: Array<{
    order_group_id: number;
    order_code: string;
    created_at: string;
    closed_at: string | null;
    resolution_required: boolean;
    totals: { items: number; revenue: number };
    tickets: Array<{
      id: number;
      stream: Stream;
      status: string;
      created_at: string | null;
      ready_at: string | null;
      delivered_at: string | null;
      lines: Array<{ ticket_id: number; name: string; qty: number; unit_price: number }>;
    }>;
    issues: Array<{
      id: number;
      ticket_id: number | null;
      stream: Stream;
      type: string | null;
      description: string | null;
      status: string;
      created_at: string;
      resolved_at?: string | null;
    }>;
  }>;
};

function money(n: number) {
  return `K ${Number(n || 0).toFixed(2)}`;
}
function fmt(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return String(s);
  }
}

/** CSV helpers (UTF-8 with BOM so Excel behaves) */
function csvEscape(v: any) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(headers: string[], rows: any[][]) {
  const bom = "\uFEFF";
  const lines = [headers.map(csvEscape).join(","), ...rows.map(r => r.map(csvEscape).join(","))];
  return bom + lines.join("\r\n");
}
function downloadCSV(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 250);
}

export default function TableReportPage() {
  const { table } = useParams<{ table: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const days = Math.max(1, Math.min(30, Number(sp.get("days") ?? 1)));

  const [data, setData] = useState<ReportJSON | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [compact, setCompact] = useState(false);

  const title = useMemo(
    () => `Table ${table} — Report (last ${days} day${days > 1 ? "s" : ""})`,
    [table, days]
  );

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    let alive = true;

    async function fetchReport(tbl: string | number, d: number): Promise<ReportJSON> {
      // Keep both endpoints for resilience
      const urls = [
        `/api/admin/table-report?table=${encodeURIComponent(String(tbl))}&days=${d}`,   // canonical
        `/api/admin/tables/report?table=${encodeURIComponent(String(tbl))}&days=${d}`,  // legacy fallback
      ];
      let lastStatus = 0;
      let lastText = "";
      for (const u of urls) {
        const r = await fetch(u, { cache: "no-store" });
        lastStatus = r.status;
        if (r.ok) return (await r.json()) as ReportJSON;
        try { lastText = await r.text(); } catch {}
      }
      throw new Error(
        `Report endpoint not found (status ${lastStatus})${
          lastText ? `: ${lastText.slice(0, 120)}…` : ""
        }`
      );
    }

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const j = await fetchReport(table, days);
        if (!alive) return;
        if (!j?.ok) throw new Error((j as any)?.error || "Failed to load report");
        setData(j);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [table, days]);

  function replaceDays(d: number) {
    router.replace(`/admin/tables/${encodeURIComponent(String(table))}/report?days=${d}`);
  }

  function exportCSVs() {
    if (!data?.ok) return;

    // Items CSV
    const itemHeaders = [
      "table",
      "order_code",
      "order_created_at",
      "order_closed_at",
      "ticket_id",
      "stream",
      "ticket_status",
      "item_name",
      "qty",
      "unit_price",
      "line_total",
    ];
    const itemRows: any[][] = [];

    for (const o of data.orders) {
      for (const t of o.tickets) {
        for (const L of t.lines) {
          itemRows.push([
            data.table,
            o.order_code,
            fmt(o.created_at),
            fmt(o.closed_at),
            t.id,
            t.stream ?? "",
            t.status,
            L.name,
            L.qty,
            Number(L.unit_price).toFixed(2),
            (Number(L.qty) * Number(L.unit_price)).toFixed(2),
          ]);
        }
        // If a ticket had no lines, still include a row for clarity
        if (t.lines.length === 0) {
          itemRows.push([
            data.table,
            o.order_code,
            fmt(o.created_at),
            fmt(o.closed_at),
            t.id,
            t.stream ?? "",
            t.status,
            "(no items)",
            0,
            (0).toFixed(2),
            (0).toFixed(2),
          ]);
        }
      }
    }

    const itemsCSV = toCSV(itemHeaders, itemRows);
    downloadCSV(`table-${data.table}-items-${days}d.csv`, itemsCSV);

    // Issues CSV
    const issueHeaders = [
      "table",
      "order_code",
      "ticket_id",
      "stream",
      "type",
      "description",
      "status",
      "opened_at",
      "resolved_at",
    ];
    const issueRows: any[][] = [];
    for (const o of data.orders) {
      for (const is of o.issues) {
        issueRows.push([
          data.table,
          o.order_code,
          is.ticket_id ?? "",
          is.stream ?? "",
          (is.type || "").replace("_", " "),
          is.description ?? "",
          is.status,
          fmt(is.created_at),
          fmt(is.resolved_at ?? null),
        ]);
      }
    }
    const issuesCSV = toCSV(issueHeaders, issueRows);
    downloadCSV(`table-${data.table}-issues-${days}d.csv`, issuesCSV);
  }

  return (
    <main className="mx-auto max-w-4xl p-6 print:p-0">
      <style>{`
        @media print {
          .no-print { display: none !important }
          body { background: white }
          .card { break-inside: avoid; page-break-inside: avoid }
          .summary { margin-top: 0; }
        }
        .hair { border-top: 1px solid #e5e7eb }
        .toolbar { position: sticky; top: 0; background: white; z-index: 10; }
      `}</style>

      {/* Toolbar */}
      <header className="toolbar mb-4 flex flex-wrap items-center justify-between gap-3 no-print border-b pb-3">
        <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Days quick-select */}
          <div className="inline-flex rounded-xl border p-1">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                className={`px-3 py-1 text-sm rounded-lg ${days === d ? "bg-black text-white" : ""}`}
                onClick={() => replaceDays(d)}
              >
                {d}d
              </button>
            ))}
            <button
              className="px-3 py-1 text-sm rounded-lg"
              title="Custom range (days)"
              onClick={() => {
                const v = prompt("How many days? (1-30)", String(days));
                const n = Number(v);
                if (Number.isFinite(n) && n >= 1 && n <= 30) replaceDays(n);
              }}
            >
              …
            </button>
          </div>

          {/* View toggle */}
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${compact ? "bg-gray-900 text-white" : ""}`}
            onClick={() => setCompact((v) => !v)}
            title="Toggle compact view"
          >
            {compact ? "Expanded view" : "Compact view"}
          </button>

          {/* Actions */}
          <a
            href="/admin"
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Back to admin
          </a>
          <button
            onClick={exportCSVs}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            title="Download Items and Issues CSV"
          >
            Export CSV
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg border bg-black text-white px-3 py-2 text-sm hover:opacity-90"
          >
            Print
          </button>
        </div>
      </header>

      {loading ? (
        <div className="rounded-xl border p-4 bg-white">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border p-4 bg-white text-red-700">Error: {err}</div>
      ) : !data?.ok ? (
        <div className="rounded-xl border p-4 bg-white">Could not load report.</div>
      ) : (
        <>
          {/* Summary */}
          <section className="summary rounded-xl border p-4 bg-white">
            <div className="text-sm text-gray-600">
              From <strong>{fmt(data.range.from)}</strong> to{" "}
              <strong>{fmt(data.range.to)}</strong>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border p-3">
                Orders: <span className="font-semibold">{data.totals.orders}</span>
              </div>
              <div className="rounded-lg border p-3">
                Items: <span className="font-semibold">{data.totals.items}</span>
              </div>
              <div className="rounded-lg border p-3">
                Revenue: <span className="font-semibold">{money(data.totals.revenue)}</span>
              </div>
            </div>
          </section>

          {/* Orders */}
          <section className="mt-6 space-y-6">
            {data.orders.map((o) => (
              <div key={o.order_group_id} className="card rounded-xl border p-4 bg-white">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    Order <span className="font-mono">{o.order_code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm">
                      Total: <span className="font-semibold">{money(o.totals.revenue)}</span>
                    </div>
                    <a
                      href={`/status/${encodeURIComponent(o.order_code)}`}
                      className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-50 no-print"
                    >
                      Open status
                    </a>
                  </div>
                </div>

                <div className="mt-1 text-sm text-gray-600">
                  Created: {fmt(o.created_at)} • Closed: {fmt(o.closed_at)}
                  {o.resolution_required && (
                    <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">
                      had issues
                    </span>
                  )}
                </div>

                <div className={`mt-3 grid ${compact ? "md:grid-cols-1" : "md:grid-cols-2"} gap-3`}>
                  {o.tickets.map((t) => {
                    const lines = compact ? t.lines.slice(0, 3) : t.lines;
                    const hiddenCount = Math.max(0, t.lines.length - lines.length);
                    return (
                      <div key={t.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium capitalize">{t.stream ?? "—"}</div>
                          <div className="text-xs rounded-full border px-2 py-0.5">
                            {t.status}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          Received: {fmt(t.created_at)} • Ready: {fmt(t.ready_at)} • Delivered:{" "}
                          {fmt(t.delivered_at)}
                        </div>
                        <ul className="mt-2 text-sm">
                          {lines.map((L, i) => (
                            <li key={i} className="flex items-center justify-between py-0.5 hair">
                              <span className="truncate">
                                {L.name} × {L.qty}
                              </span>
                              <span className="font-medium">
                                {money(Number(L.qty) * Number(L.unit_price))}
                              </span>
                            </li>
                          ))}
                          {hiddenCount > 0 && (
                            <li className="py-0.5 text-xs text-gray-500">
                              +{hiddenCount} more…
                            </li>
                          )}
                          {t.lines.length === 0 && <li className="text-gray-500">No items</li>}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3">
                  <div className="font-medium">Issues</div>
                  {o.issues.length === 0 ? (
                    <div className="text-sm text-gray-600">None</div>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {o.issues.map((is) => (
                        <li key={is.id} className="rounded-lg border px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="capitalize">
                                {(is.type || "issue").replace("_", " ")}
                              </span>
                              {is.stream ? <span> • {is.stream}</span> : null}
                              {is.description ? <span> — {is.description}</span> : null}
                            </div>
                            <span className="text-xs rounded-full border px-2 py-0.5">
                              {is.status}
                            </span>
                          </div>
                          <div className="text-xs text-gray-600">
                            Opened: {fmt(is.created_at)}{" "}
                            {is.resolved_at ? `• Resolved: ${fmt(is.resolved_at)}` : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
