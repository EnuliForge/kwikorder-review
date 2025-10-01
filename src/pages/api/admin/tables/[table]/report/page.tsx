"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

/** Shapes returned by /api/admin/table-report */
type Stream = "food" | "drinks" | null;

type ReportLine = {
  ticket_id: number;
  name: string;
  qty: number;
  unit_price: number;
};

type ReportTicket = {
  id: number;
  stream: Stream;
  status: string;
  created_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  lines: ReportLine[];
};

type ReportIssue = {
  id: number;
  ticket_id: number | null;
  stream: Stream;
  type: string | null;
  description: string | null;
  status: string;
  created_at: string | null;
  resolved_at: string | null;
};

type ReportOrder = {
  order_group_id: number;
  order_code: string;
  created_at: string;
  closed_at: string | null;
  resolution_required: boolean;
  totals: { items: number; revenue: number };
  tickets: ReportTicket[];
  issues: ReportIssue[];
};

type ReportPayload = {
  ok: boolean;
  table: number;
  range: { from: string; to: string; days: number };
  totals: { orders: number; items: number; revenue: number };
  orders: ReportOrder[];
};

export default function TableReportPage() {
  const { table } = useParams<{ table: string }>();
  const sp = useSearchParams();
  const router = useRouter();

  const tbl = Number(table);
  const days = Math.max(1, Math.min(30, Number(sp.get("days") || 1)));

  const [data, setData] = useState<ReportPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const url = `/api/admin/table-report?table=${encodeURIComponent(String(tbl))}&days=${days}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status} — ${txt.slice(0, 200)}`);
      }
      const j = (await r.json()) as ReportPayload;
      if (!j?.ok) throw new Error((j as any)?.error || "Failed to load report");
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(tbl) || tbl <= 0) {
      router.replace("/admin");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tbl, days]);

  const titleDays = useMemo(() => `${days} day${days > 1 ? "s" : ""}`, [days]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Table {Number.isFinite(tbl) ? tbl : "—"} — Report (last {titleDays})
        </h1>

        <div className="flex gap-2 print:hidden">
          <a
            href="/admin"
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Back to admin
          </a>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-black text-white px-3 py-2 text-sm"
          >
            Print
          </button>
        </div>
      </header>

      {loading ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Error: {err}
        </div>
      ) : !data?.ok ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">
          No data for this range.
        </div>
      ) : (
        <>
          {/* Totals summary */}
          <section className="mb-4 grid gap-2 sm:grid-cols-3 print:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Orders</div>
              <div className="text-lg font-semibold">{data.totals.orders}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Items</div>
              <div className="text-lg font-semibold">{data.totals.items}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-gray-500">Revenue</div>
              <div className="text-lg font-semibold">
                K {Number(data.totals.revenue || 0).toFixed(2)}
              </div>
            </div>
          </section>

          {/* Orders */}
          {data.orders.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-gray-600">
              No orders in this period.
            </div>
          ) : (
            <div className="grid gap-4">
              {data.orders.map((o) => (
                <article key={o.order_group_id} className="rounded-2xl border p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="font-semibold">
                      Order <span className="font-mono">{o.order_code}</span>
                    </div>
                    <div className="text-sm">
                      Total:{" "}
                      <span className="font-semibold">
                        K {Number(o.totals.revenue || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600">
                    Created: {new Date(o.created_at).toLocaleString()}
                    {o.closed_at ? (
                      <> • Closed: {new Date(o.closed_at).toLocaleString()}</>
                    ) : (
                      <> • Open</>
                    )}
                    {o.resolution_required ? (
                      <> • Needs attention</>
                    ) : null}
                  </div>

                  {/* Tickets */}
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {o.tickets.map((t) => (
                      <div key={t.id} className="rounded-lg border p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-sm font-medium capitalize">
                            {t.stream ?? "—"}
                          </div>
                          <StatusPill s={t.status} />
                        </div>
                        <ul className="text-sm text-gray-800">
                          {t.lines.length === 0 ? (
                            <li className="text-gray-500">No items</li>
                          ) : (
                            t.lines.map((li, i) => (
                              <li key={i} className="flex justify-between">
                                <span className="truncate">{li.name}</span>
                                <span className="ml-3">
                                  ×{li.qty} — K{" "}
                                  {(Number(li.qty || 0) * Number(li.unit_price || 0)).toFixed(2)}
                                </span>
                              </li>
                            ))
                          )}
                        </ul>
                        <div className="mt-2 text-xs text-gray-600">
                          {t.created_at && <>Recvd: {new Date(t.created_at).toLocaleTimeString()} </>}
                          {t.ready_at && <>• Ready: {new Date(t.ready_at).toLocaleTimeString()} </>}
                          {t.delivered_at && (
                            <>• Delivered: {new Date(t.delivered_at).toLocaleTimeString()}</>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Issues */}
                  {o.issues.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="mb-1 text-sm font-semibold">Issues</div>
                      <ul className="text-sm">
                        {o.issues.map((is) => (
                          <li key={is.id} className="flex items-start justify-between">
                            <div>
                              <span className="capitalize">{(is.stream ?? "—")}</span>
                              {" • "}
                              <span className="capitalize">
                                {(is.type || "").replace("_", " ") || "Issue"}
                              </span>
                              {is.description ? <> — {is.description}</> : null}
                              <div className="text-xs text-gray-600">
                                Opened: {is.created_at ? new Date(is.created_at).toLocaleString() : "—"}
                                {is.resolved_at && (
                                  <> • Resolved: {new Date(is.resolved_at).toLocaleString()}</>
                                )}
                              </div>
                            </div>
                            <StatusPill s={is.status} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
    </main>
  );
}

/** Tiny pill component (kept local to this page) */
function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    open: "bg-amber-100 text-amber-800",
    runner_ack: "bg-sky-100 text-sky-800",
    client_ack: "bg-purple-100 text-purple-800",
    resolved: "bg-emerald-100 text-emerald-800",
    received: "bg-gray-100 text-gray-700",
    preparing: "bg-sky-100 text-sky-800",
    ready: "bg-amber-100 text-amber-800",
    delivered: "bg-emerald-100 text-emerald-800",
    completed: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full capitalize ${map[s] || "bg-gray-100"}`}>
      {s.replace("_", " ")}
    </span>
  );
}
