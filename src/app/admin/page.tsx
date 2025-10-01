// src/app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COLOR_CLASSES,
  getOrderCardColor,
  type TableOrderLite,
} from "@/lib/adminColors";

/* ===================== Types ===================== */
type Ticket = {
  id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";
  ready_at?: string | null;
  delivered_at?: string | null;
};

type OrderRow = {
  id: number;
  order_code: string;
  table_number: number | null;
  created_at: string;
  closed_at: string | null;
  resolution_required: boolean;
  tickets: Ticket[];
  issues: { status: "open" | "runner_ack" | "client_ack" | "resolved" }[];
};

type IssueRow = {
  id: number;
  order_code: string;
  table_number: number | null;
  stream: "food" | "drinks" | null;
  type: string | null;
  description: string | null;
  status: "open" | "runner_ack" | "client_ack" | "resolved";
  created_at: string;
};

type TableSummary = {
  table_number: number;
  orders_count: number;
  items_count: number;
  current_order_code: string | null;
  has_issue: boolean;
  revenue: number;            // legacy
  revenue_today?: number;     // preferred
};

type TableIssue = {
  id: number;
  order_code: string;
  stream: "food" | "drinks" | null;
  type: string | null;
  description: string | null;
  status: IssueRow["status"];
  created_at: string;
};

type TableOrderItems = {
  order_code: string;
  created_at: string;
  total: number; // K
  items: { name: string; stream: "food" | "drinks" | null; qty: number; line_total: number }[];
};

/* Active-for-table API shapes we use */
type OgRow = {
  id: number;
  order_code: string;
  table_number: number | null;
  created_at: string;
  resolution_required: boolean;
  closed_at: string | null;
};
type ActiveForTableResp = {
  ok: boolean;
  orders: OgRow[];
  active_orders: OgRow[];
  recent_closed_orders: OgRow[];
  summary: {
    color: "white" | "orange" | "green" | "red" | "purple";
    label: string;
    active_count: number;
    multiple: boolean;
    has_issue: boolean;
    lookback_mins?: number;
  };
};

/* ===================== UI bits ===================== */
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

/* ===================== Page ===================== */
export default function AdminPage() {
  const router = useRouter();

  const [tab, setTab] = useState<"tables" | "orders" | "issues">("tables");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  /* -------- Orders & Issues (global lists) -------- */
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [busyIssueId, setBusyIssueId] = useState<number | null>(null);

  async function loadOrdersIssues() {
    setErr(null);
    try {
      const [oRes, iRes] = await Promise.all([
        fetch("/api/admin/orders/list"),
        fetch("/api/admin/issues/list"),
      ]);
      const [o, i] = await Promise.all([oRes.json(), iRes.json()]);
      if (!o.ok) throw new Error(o.error || "Failed loading orders");
      if (!i.ok) throw new Error(i.error || "Failed loading issues");
      setOrders(o.rows || []);
      setIssues(i.rows || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    }
  }

  useEffect(() => {
    loadOrdersIssues();
    const t = setInterval(loadOrdersIssues, 5000);
    return () => clearInterval(t);
  }, []);

  const filteredOrders = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders;
    return orders.filter(
      (r) =>
        r.order_code.toLowerCase().includes(s) ||
        (r.table_number !== null && String(r.table_number).includes(s))
    );
  }, [orders, q]);

  const filteredIssues = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return issues;
    return issues.filter(
      (r) =>
        r.order_code.toLowerCase().includes(s) ||
        (r.table_number !== null && String(r.table_number).includes(s)) ||
        (r.type || "").toLowerCase().includes(s) ||
        (r.description || "").toLowerCase().includes(s)
    );
  }, [issues, q]);

  async function resolveIssue(id: number) {
    const note = prompt("Resolution note (optional):") || "";
    setBusyIssueId(id);
    try {
      const r = await fetch("/api/admin/issues/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issue_id: id, resolution_note: note }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Resolve failed");
      await loadOrdersIssues();
      await loadTableSummaries();
      if (selectedTable !== null) await openTable(selectedTable);
    } catch (e: any) {
      alert(e?.message || "Failed to resolve");
    } finally {
      setBusyIssueId(null);
    }
  }

  /* -------- Tables summary + drawer -------- */
  const [summaries, setSummaries] = useState<TableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);

  const [tableColors, setTableColors] = useState<
    Record<number, { color: ActiveForTableResp["summary"]["color"]; label: string; multiple: boolean }>
  >({});

  const [drawerTab, setDrawerTab] = useState<"items" | "issues">("items");
  const [tableIssues, setTableIssues] = useState<TableIssue[]>([]);
  const [tableItems, setTableItems] = useState<TableOrderItems[]>([]);
  const [loadingTbl, setLoadingTbl] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [drawerActive, setDrawerActive] = useState<OgRow[]>([]);
  const [drawerRecentClosed, setDrawerRecentClosed] = useState<OgRow[]>([]);

  async function loadTableSummaries() {
    try {
      const r = await fetch("/api/admin/tables/summary?max=10");
    const j = await r.json();
      if (j?.ok) setSummaries(j.rows || []);
    } catch {}
  }

  useEffect(() => {
    loadTableSummaries();
    const t = setInterval(loadTableSummaries, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const next: typeof tableColors = {};
      await Promise.all(
        summaries.map(async (s) => {
          try {
            const r = await fetch(`/api/orders/active-for-table?table=${s.table_number}`);
            const j: ActiveForTableResp = await r.json();
            if (!j?.ok) return;
            next[s.table_number] = {
              color: j.summary.color,
              label: j.summary.label,
              multiple: j.summary.multiple,
            };
          } catch {}
        })
      );
      if (!cancel) setTableColors(next);
    })();
    return () => {
      cancel = true;
    };
  }, [summaries]);

  async function openTable(tbl: number) {
    setSelectedTable(tbl);
    setDrawerTab("items");
    setLoadingTbl(true);
    setLoadingItems(true);
    try {
      const [issuesRes, itemsRes, actRes] = await Promise.all([
        fetch(`/api/admin/tables/issues?table=${tbl}`),
        fetch(`/api/admin/tables/items?table=${tbl}`),
        fetch(`/api/orders/active-for-table?table=${tbl}`),
      ]);
      const [issuesJson, itemsJson, actJson] = await Promise.all([
        issuesRes.json(),
        itemsRes.json(),
        actRes.json(),
      ]);

      if (issuesJson?.ok) setTableIssues(issuesJson.rows || []);
      if (itemsJson?.ok) setTableItems(itemsJson.rows || []);

      if (actJson?.ok) {
        setDrawerActive(actJson.active_orders || actJson.orders || []);
        setDrawerRecentClosed(actJson.recent_closed_orders || []);
      } else {
        setDrawerActive([]);
        setDrawerRecentClosed([]);
      }
    } finally {
      setLoadingTbl(false);
      setLoadingItems(false);
    }
  }

  function colorForDrawerOrder(order_code: string): keyof typeof COLOR_CLASSES {
    const a = drawerActive.find((o) => o.order_code === order_code);
    if (a) {
      const lite: TableOrderLite = {
        order_code: a.order_code,
        closed_at: a.closed_at,
        resolution_required: a.resolution_required,
      };
      return getOrderCardColor(lite);
    }
    const c = drawerRecentClosed.find((o) => o.order_code === order_code);
    if (c) return "green";
    return "white";
  }

  /* -------- Report modal (global) -------- */
  const [showReport, setShowReport] = useState(false);
  const [reportScope, setReportScope] = useState<"table" | "total">("table");
  const [reportTable, setReportTable] = useState<number | null>(null);
  const [reportDays, setReportDays] = useState<number>(1);

  function openReportPrompt(defaultTable?: number) {
    setReportScope("table");
    setReportTable(defaultTable ?? (selectedTable ?? summaries[0]?.table_number ?? null));
    setReportDays(1);
    setShowReport(true);
  }

  function goToReport() {
    setShowReport(false);
    if (reportScope === "total") {
      router.push(`/admin/reports/total?days=${reportDays}`);
    } else {
      if (!reportTable) {
        alert("Pick a table");
        return;
      }
      router.push(`/admin/tables/${reportTable}/report?days=${reportDays}`);
    }
  }

  /* ===================== Render ===================== */
  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Admin</h1>
        <div className="flex gap-2">
          <a href="/kitchen" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Kitchen</a>
          <a href="/bar" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Bar</a>
          <a href="/runner" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Runner</a>
          <a href="/admin/menu" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Menu</a>
          <button
            className="text-sm rounded-lg border px-3 py-2 bg-red-600 text-white hover:bg-red-700 border-red-600"
            onClick={() => openReportPrompt()}
          >
            Report
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex rounded-xl border p-1">
          <button
            className={`px-3 py-1 text-sm rounded-lg ${tab === "tables" ? "bg-black text-white" : ""}`}
            onClick={() => setTab("tables")}
          >
            Tables
          </button>
          <button
            className={`px-3 py-1 text-sm rounded-lg ${tab === "orders" ? "bg-black text-white" : ""}`}
            onClick={() => setTab("orders")}
          >
            Orders
          </button>
          <button
            className={`px-3 py-1 text-sm rounded-lg ${tab === "issues" ? "bg-black text-white" : ""}`}
            onClick={() => setTab("issues")}
          >
            Issues
          </button>
        </div>
        <input
          className="w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="Search by order code, table #, or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => {
            loadOrdersIssues();
            loadTableSummaries();
            if (selectedTable !== null) openTable(selectedTable);
          }}
        >
          Refresh
        </button>
      </div>

      {/* ========== Tables tab ========== */}
      {tab === "tables" && (
        <section>
          <div className="mb-2 text-xs text-gray-500">
            Legend:&nbsp;
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 mr-1 ${COLOR_CLASSES.white}`}>No orders</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 mr-1 ${COLOR_CLASSES.orange}`}>Order present</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 mr-1 ${COLOR_CLASSES.purple}`}>Multiple orders</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 mr-1 ${COLOR_CLASSES.red}`}>Order issue</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${COLOR_CLASSES.green}`}>Orders solved</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {summaries.map((s) => {
              const tState = tableColors[s.table_number] || { color: "white" as const, label: "No orders", multiple: false };
              const colorClass = COLOR_CLASSES[tState.color];
              const currentDisplay = tState.multiple ? "Multiple" : s.current_order_code ?? "—";
              const revenueK = Number(s.revenue_today ?? s.revenue ?? 0);
              return (
                <button
                  key={s.table_number}
                  onClick={() => openTable(s.table_number)}
                  className={`text-left rounded-2xl border p-4 hover:shadow transition ${colorClass}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">Table {s.table_number}</div>
                    <span className="text-xs rounded-full border px-2 py-0.5">
                      {tState.label}
                    </span>
                  </div>
                  <div className="mt-2 text-sm grid gap-1">
                    <div>
                      Today’s orders: <span className="font-semibold">{s.orders_count}</span>
                    </div>
                    <div>
                      Items total: <span className="font-semibold">{s.items_count}</span>
                    </div>
                    <div className="text-gray-700">
                      Current order: <span className="font-mono">{currentDisplay}</span>
                    </div>
                    <div className="text-gray-900">
                      Revenue today: <span className="font-semibold">K {revenueK.toFixed(2)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Drill-down drawer (scrollable) */}
          {selectedTable !== null && (
            <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-3">
              <div className="bg-white w-full sm:w-[700px] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="flex items-center justify-between border-b px-5 py-3">
                  <div className="text-lg font-semibold">Table {selectedTable} — details</div>
                  <div className="flex gap-2">
                    <a
                      href={`/status/table/${selectedTable}`}
                      className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                    >
                      View table status
                    </a>
                    <a
                      href={`/admin/tables/${selectedTable}/report?days=1`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                    >
                      Print report
                    </a>
                    <button
                      className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                      onClick={() => setSelectedTable(null)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* Body (scrolls) */}
                <div className="overflow-y-auto px-5 py-4">
                  {/* Sub-tabs */}
                  <div className="inline-flex rounded-xl border p-1">
                    <button
                      className={`px-3 py-1 text-sm rounded-lg ${drawerTab === "items" ? "bg-black text-white" : ""}`}
                      onClick={() => setDrawerTab("items")}
                    >
                      Items
                    </button>
                    <button
                      className={`px-3 py-1 text-sm rounded-lg ${drawerTab === "issues" ? "bg-black text-white" : ""}`}
                      onClick={() => setDrawerTab("issues")}
                    >
                      Issues
                    </button>
                  </div>

                  {/* Items tab */}
                  {drawerTab === "items" && (
                    <div className="mt-4">
                      {loadingItems ? (
                        <div className="text-sm text-gray-600">Loading…</div>
                      ) : tableItems.length === 0 ? (
                        <div className="rounded-lg border p-3 text-sm text-gray-600">No orders for today.</div>
                      ) : (
                        <div className="grid gap-3">
                          {tableItems.map((ord) => {
                            const colorKey = colorForDrawerOrder(ord.order_code);
                            const colorClass = COLOR_CLASSES[colorKey];
                            return (
                              <div key={ord.order_code} className={`rounded-xl border p-4 ${colorClass}`}>
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold">
                                    <span className="text-gray-600">Order</span>{" "}
                                    <span className="font-mono">{ord.order_code}</span>
                                  </div>
                                  <div className="text-sm">
                                    Total: <span className="font-semibold">K {ord.total.toFixed(2)}</span>
                                  </div>
                                </div>
                                <ul className="mt-2 space-y-1 text-sm">
                                  {ord.items.map((it, idx) => (
                                    <li key={idx} className="flex items-center justify-between">
                                      <div>
                                        <span className="capitalize">{it.stream ?? "—"}</span>
                                        {" • "}
                                        <span className="font-medium">{it.name}</span>
                                        {" × "}
                                        <span>{it.qty}</span>
                                      </div>
                                      <div className="font-semibold">K {it.line_total.toFixed(2)}</div>
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-3">
                                  <a
                                    href={`/status?code=${encodeURIComponent(ord.order_code)}`}
                                    className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                                  >
                                    Open status
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Issues tab */}
                  {drawerTab === "issues" && (
                    <div className="mt-4">
                      {loadingTbl ? (
                        <div className="text-sm text-gray-600">Loading…</div>
                      ) : tableIssues.length === 0 ? (
                        <div className="rounded-lg border p-3 text-sm text-gray-600">No unresolved issues.</div>
                      ) : (
                        <ul className="space-y-2">
                          {tableIssues.map((it) => (
                            <li key={it.id} className="rounded-lg border px-3 py-2">
                              <div className="flex items-center justify-between">
                                <div className="text-sm">
                                  <span className="font-mono">{it.order_code}</span> •{" "}
                                  <span className="capitalize">{it.stream ?? "—"}</span>
                                </div>
                                <StatusPill s={it.status} />
                              </div>
                              <div className="text-sm mt-1">
                                <span className="capitalize">
                                  {(it.type || "").replace("_", " ") || "Issue"}
                                </span>
                                {it.description ? (
                                  <> — <span className="text-gray-700">{it.description}</span></>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ========== Orders tab ========== */}
      {tab === "orders" && (
        <section className="grid gap-3">
          {filteredOrders.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-gray-600">No open orders.</div>
          ) : (
            filteredOrders.map((r) => {
              const food = r.tickets.find((t) => t.stream === "food");
              const drinks = r.tickets.find((t) => t.stream === "drinks");
              const openIssues = r.issues.filter((i) => i.status !== "resolved").length;
              return (
                <div key={r.id} className="rounded-2xl border p-4 bg-white">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">
                      Table {r.table_number ?? "—"} •{" "}
                      <span className="font-mono">{r.order_code}</span>
                    </div>
                    {r.resolution_required && (
                      <span className="text-xs rounded-full border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1">
                        Attention required
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid sm:grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-gray-500">Food</div>
                      <div className="mt-1"><StatusPill s={food?.status || "received"} /></div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-gray-500">Drinks</div>
                      <div className="mt-1"><StatusPill s={drinks?.status || "received"} /></div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-gray-500">Issues</div>
                      <div className="mt-1">{openIssues} open</div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <a
                      href={`/status?code=${encodeURIComponent(r.order_code)}`}
                      className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                    >
                      Open status
                    </a>
                    <a href="/runner" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">
                      Notify runner
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {/* ========== Issues tab ========== */}
      {tab === "issues" && (
        <section className="grid gap-3">
          {filteredIssues.length === 0 ? (
            <div className="rounded-xl border p-4 text-sm text-gray-600">No unresolved issues.</div>
          ) : (
            filteredIssues.map((it) => (
              <div key={it.id} className="rounded-2xl border p-4 bg-white">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    Table {it.table_number ?? "—"} •{" "}
                    <span className="font-mono">{it.order_code}</span>
                  </div>
                  <StatusPill s={it.status} />
                </div>
                <div className="mt-2 text-sm">
                  <div>
                    <span className="text-gray-500">Stream:</span>{" "}
                    <span className="capitalize">{it.stream ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Type:</span>{" "}
                    <span className="capitalize">{(it.type || "").replace("_", " ") || "—"}</span>
                  </div>
                  {it.description && <div className="text-gray-700 mt-1">{it.description}</div>}
                </div>
                <div className="mt-3 flex gap-2">
                  <a
                    href={`/status?code=${encodeURIComponent(it.order_code)}`}
                    className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50"
                  >
                    Open status
                  </a>
                  <button
                    onClick={() => resolveIssue(it.id)}
                    disabled={busyIssueId === it.id}
                    className="text-sm rounded-lg border bg-black text-white px-3 py-2 hover:opacity-90 disabled:opacity-60"
                  >
                    {busyIssueId === it.id ? "Resolving…" : "Mark resolved"}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* ===== Report Modal ===== */}
      {showReport && (
        <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Build a report</div>
                <button
                  className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={() => setShowReport(false)}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-4">
                {/* Scope */}
                <div className="grid gap-2 text-sm">
                  <span className="text-gray-600">Scope</span>
                  <div className="inline-flex rounded-xl border p-1">
                    <button
                      className={`px-3 py-1 text-sm rounded-lg ${reportScope === "table" ? "bg-black text-white" : ""}`}
                      onClick={() => setReportScope("table")}
                    >
                      Table
                    </button>
                    <button
                      className={`px-3 py-1 text-sm rounded-lg ${reportScope === "total" ? "bg-black text-white" : ""}`}
                      onClick={() => setReportScope("total")}
                    >
                      Total sales
                    </button>
                  </div>
                </div>

                {/* Table picker (only if table scope) */}
                {reportScope === "table" && (
                  <label className="grid gap-1 text-sm">
                    <span className="text-gray-600">Table</span>
                    <select
                      className="rounded-lg border px-3 py-2"
                      value={reportTable ?? ""}
                      onChange={(e) =>
                        setReportTable(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="" disabled>Select a table…</option>
                      {summaries.map((s) => (
                        <option key={s.table_number} value={s.table_number}>
                          Table {s.table_number}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Range */}
                <div className="grid gap-2 text-sm">
                  <span className="text-gray-600">Range</span>
                  <div className="inline-flex rounded-xl border p-1">
                    {[1, 7, 30].map((d) => (
                      <button
                        key={d}
                        className={`px-3 py-1 text-sm rounded-lg ${reportDays === d ? "bg-black text-white" : ""}`}
                        onClick={() => setReportDays(d)}
                      >
                        {d}d
                      </button>
                    ))}
                    <button
                      className="px-3 py-1 text-sm rounded-lg"
                      onClick={() => {
                        const v = prompt("Custom days (1-30):", String(reportDays));
                        const n = Number(v);
                        if (Number.isFinite(n) && n >= 1 && n <= 30) {
                          setReportDays(n);
                        }
                      }}
                    >
                      …
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg border px-3 py-2 text-sm"
                    onClick={() => setShowReport(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-lg bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
                    disabled={reportScope === "table" && !reportTable}
                    onClick={goToReport}
                  >
                    Open report
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
