// src/app/admin/reports/total/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Stream = "food" | "drinks" | null;

type VenueReportJSON = {
  ok: boolean;
  range: { from: string; to: string; days: number };
  totals: { orders: number; items: number; revenue: number };
  by_table: Array<{ table_number: number; orders: number; items: number; revenue: number }>;
  orders: Array<{
    order_group_id: number;
    order_code: string;
    table_number: number | null;
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
  try { return new Date(s).toLocaleString(); } catch { return String(s); }
}
function csvEscape(v: any) {
  const s = v == null ? "" : String(v);
  // wrap if contains comma/quote/newline; escape quotes
  const needsWrap = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsWrap ? `"${escaped}"` : escaped;
}
function downloadCsv(filename: string, csv: string) {
  // Add BOM for Excel friendliness
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const sp = useSearchParams();
const rawDays = sp?.get("days");               // guard for nullable typing
const days = Math.max(1, Math.min(30, Number(rawDays ?? 1)));

  const [data, setData] = useState<VenueReportJSON | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const title = useMemo(
    () => `Venue — Total Sales (last ${days} day${days > 1 ? "s" : ""})`,
    [days]
  );

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    let alive = true;

    async function fetchReport(d: number): Promise<VenueReportJSON> {
      const r = await fetch(`/api/admin/venue-report?days=${d}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text().catch(() => "Failed to load report"));
      return (await r.json()) as VenueReportJSON;
    }

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const j = await fetchReport(days);
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

    return () => { alive = false; };
  }, [days]);

  // ------- CSV builders -------
  function buildItemsCsv(d: VenueReportJSON) {
    const headers = [
      "range_from","range_to","days",
      "order_code","table_number","order_created_at","order_closed_at","order_resolution_required",
      "ticket_stream","ticket_status","ticket_created_at","ticket_ready_at","ticket_delivered_at",
      "item_name","qty","unit_price","line_total","order_issue_count"
    ];
    const rows: string[] = [headers.join(",")];

    for (const o of d.orders) {
      const issueCount = o.issues.length;
      for (const t of o.tickets) {
        for (const L of t.lines) {
          const line = [
            d.range.from, d.range.to, d.range.days,
            o.order_code, o.table_number ?? "",
            o.created_at, o.closed_at ?? "",
            o.resolution_required ? "yes" : "no",
            t.stream ?? "", t.status, t.created_at ?? "", t.ready_at ?? "", t.delivered_at ?? "",
            L.name, L.qty, Number(L.unit_price).toFixed(2), (Number(L.unit_price) * Number(L.qty)).toFixed(2),
            issueCount
          ].map(csvEscape).join(",");
          rows.push(line);
        }
        // include rows for tickets that had no lines to preserve visibility
        if (t.lines.length === 0) {
          const line = [
            d.range.from, d.range.to, d.range.days,
            o.order_code, o.table_number ?? "",
            o.created_at, o.closed_at ?? "",
            o.resolution_required ? "yes" : "no",
            t.stream ?? "", t.status, t.created_at ?? "", t.ready_at ?? "", t.delivered_at ?? "",
            "", "", "", "", issueCount
          ].map(csvEscape).join(",");
          rows.push(line);
        }
      }
      // orders with no tickets at all
      if (o.tickets.length === 0) {
        const line = [
          d.range.from, d.range.to, d.range.days,
          o.order_code, o.table_number ?? "",
          o.created_at, o.closed_at ?? "",
          o.resolution_required ? "yes" : "no",
          "", "", "", "", "",
          "", "", "", "", issueCount
        ].map(csvEscape).join(",");
        rows.push(line);
      }
    }
    return rows.join("\r\n");
  }

  function buildByTableCsv(d: VenueReportJSON) {
    const headers = ["range_from","range_to","days","table_number","orders","items","revenue"];
    const rows: string[] = [headers.join(",")];
    for (const r of d.by_table) {
      rows.push([
        d.range.from, d.range.to, d.range.days,
        r.table_number, r.orders, r.items, Number(r.revenue).toFixed(2)
      ].map(csvEscape).join(","));
    }
    return rows.join("\r\n");
  }

  function handleExportItemsCsv() {
    if (!data?.ok) return;
    const csv = buildItemsCsv(data);
    const fname = `venue-total-items_${data.range.from.slice(0,10)}_${data.range.to.slice(0,10)}.csv`;
    downloadCsv(fname, csv);
  }
  function handleExportByTableCsv() {
    if (!data?.ok) return;
    const csv = buildByTableCsv(data);
    const fname = `venue-total-by-table_${data.range.from.slice(0,10)}_${data.range.to.slice(0,10)} .csv`;
    downloadCsv(fname, csv);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 print:p-0">
      <style>{`
        @media print { .no-print{display:none!important} body{background:white} }
        .hair{border-top:1px solid #e5e7eb}
      `}</style>

      <header className="mb-4 flex items-center justify-between no-print">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <a href="/admin" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
            Back to admin
          </a>
          <button
            onClick={handleExportByTableCsv}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            title="Export per-table summary CSV"
          >
            Export tables CSV
          </button>
          <button
            onClick={handleExportItemsCsv}
            className="rounded-lg border bg-red-600 text-white px-3 py-2 text-sm hover:opacity-90"
            title="Export item-level CSV"
          >
            Export items CSV
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
          <section className="rounded-xl border p-4 bg-white">
            <div className="text-sm text-gray-600">
              From <strong>{fmt(data.range.from)}</strong> to <strong>{fmt(data.range.to)}</strong>
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

          <section className="mt-6 rounded-xl border p-4 bg-white">
            <div className="font-semibold mb-2">By table</div>
            {data.by_table.length === 0 ? (
              <div className="text-sm text-gray-600">No data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2">Table</th>
                      <th className="py-2">Orders</th>
                      <th className="py-2">Items</th>
                      <th className="py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_table.map((r) => (
                      <tr key={r.table_number} className="border-t">
                        <td className="py-2">Table {r.table_number}</td>
                        <td className="py-2">{r.orders}</td>
                        <td className="py-2">{r.items}</td>
                        <td className="py-2">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-6 space-y-6">
            {data.orders.map((o) => (
              <div key={o.order_group_id} className="rounded-xl border p-4 bg-white">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    Order <span className="font-mono">{o.order_code}</span>
                    {o.table_number ? <span className="ml-2 text-gray-600">• Table {o.table_number}</span> : null}
                  </div>
                  <div className="text-sm">
                    Total: <span className="font-semibold">{money(o.totals.revenue)}</span>
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

                <div className="mt-3 grid md:grid-cols-2 gap-3">
                  {o.tickets.map((t) => (
                    <div key={t.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium capitalize">{t.stream ?? "—"}</div>
                        <div className="text-xs rounded-full border px-2 py-0.5">{t.status}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Received: {fmt(t.created_at)} • Ready: {fmt(t.ready_at)} • Delivered: {fmt(t.delivered_at)}
                      </div>
                      <ul className="mt-2 text-sm">
                        {t.lines.map((L, i) => (
                          <li key={i} className="flex items-center justify-between py-0.5 hair">
                            <span className="truncate">{L.name} × {L.qty}</span>
                            <span className="font-medium">{money(L.qty * L.unit_price)}</span>
                          </li>
                        ))}
                        {t.lines.length === 0 && <li className="text-gray-500">No items</li>}
                      </ul>
                    </div>
                  ))}
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
                              <span className="capitalize">{(is.type || "issue").replace("_", " ")}</span>
                              {is.stream ? <span> • {is.stream}</span> : null}
                              {is.description ? <span> — {is.description}</span> : null}
                            </div>
                            <span className="text-xs rounded-full border px-2 py-0.5">{is.status}</span>
                          </div>
                          <div className="text-xs text-gray-600">
                            Opened: {fmt(is.created_at)} {is.resolved_at ? `• Resolved: ${fmt(is.resolved_at)}` : ""}
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
