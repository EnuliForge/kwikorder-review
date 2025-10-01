// src/app/status/table/[table]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Stream = "food" | "drinks";
type TicketStatus = "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";
type LineItem = { name: string; qty: number };

type Ticket = {
  id: number;
  stream: Stream;
  status: TicketStatus;
  delivered_at: string | null;
  ready_at?: string | null;
  created_at?: string;
  items?: LineItem[];
  has_issue?: boolean;
};

type IssueOut = {
  status: "open" | "runner_ack" | "client_ack" | "resolved";
  ticket_id: number | null;
  stream: Stream | null;
};

type StatusPayload = {
  ok: boolean;
  tickets: Ticket[];
  closed_at: string | null;
  customer_confirmed_at?: string | null;
  resolution_required?: boolean;
  issues?: IssueOut[];
  table_number?: number | null;
  runner_ack_ticket_ids?: number[];
  order_code?: string;
};

const ISSUE_TYPES_BY_STREAM: Record<Stream, { value: string; label: string }[]> = {
  food: [
    { value: "wrong_food", label: "Wrong food" },
    { value: "missing_item", label: "Missing item" },
    { value: "cold", label: "Cold" },
    { value: "hygiene", label: "Hygiene" },
    { value: "other", label: "Other" },
  ],
  drinks: [
    { value: "wrong_drink", label: "Wrong drink" },
    { value: "missing_item", label: "Missing item" },
    { value: "cold", label: "Not cold" },
    { value: "hygiene", label: "Hygiene" },
    { value: "other", label: "Other" },
  ],
};

function Badge({ status }: { status: Ticket["status"] }) {
  const map: Record<Ticket["status"], string> = {
    delivered: "bg-emerald-100 text-emerald-800",
    completed: "bg-emerald-100 text-emerald-800",
    ready: "bg-amber-100 text-amber-800",
    preparing: "bg-sky-100 text-sky-800",
    received: "bg-gray-100 text-gray-700",
    cancelled: "bg-red-100 text-red-800",
  };
  return <span className={`px-3 py-1 rounded-full text-sm capitalize ${map[status]}`}>{status}</span>;
}

export default function TableStatusPage() {
  const { table } = useParams<{ table: string }>();
  const router = useRouter();
  const tableNum = Number(table);

  const [orderCodes, setOrderCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function loadActiveOrders(): Promise<string[]> {
    try {
      setErr(null);
      const r = await fetch(
        `/api/orders/active-for-table?table=${encodeURIComponent(String(tableNum))}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || "Failed to load active orders");
      const codes = (j.orders ?? []).map((o: any) => String(o.order_code));
      setOrderCodes(codes);
      return codes;
    } catch (e: any) {
      setErr(e?.message || "Failed to load active orders");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(tableNum)) {
      router.replace("/status");
      return;
    }
    loadActiveOrders();
    const t = setInterval(loadActiveOrders, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableNum]);

  // after any order closes, reload; if none left → menu
  async function handleOrderClosed() {
    const codes = await loadActiveOrders();
    if (codes.length === 0) {
      router.replace("/menu");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold">Table {Number.isFinite(tableNum) ? tableNum : "—"}</h1>
          <span className="ml-3 rounded-full border px-3 py-1 text-sm">
            Active orders: <span className="font-semibold">{orderCodes.length}</span>
          </span>
        </div>
        <a href="/menu" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
          Back to Menu
        </a>
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      {loading ? (
        <div className="grid gap-4">
          <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
        </div>
      ) : orderCodes.length === 0 ? (
        <div className="rounded-xl border bg-white p-4 text-gray-600">No active orders.</div>
      ) : (
        <div className="grid gap-6">
          {orderCodes.map((oc) => (
            <OrderStatusPanel key={oc} orderCode={oc} onClosed={handleOrderClosed} />
          ))}
        </div>
      )}
    </main>
  );
}

function OrderStatusPanel({ orderCode, onClosed }: { orderCode: string; onClosed: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [customerConfirmedAt, setCustomerConfirmedAt] = useState<string | null>(null);
  const [resolutionRequired, setResolutionRequired] = useState<boolean>(false);
  const [issues, setIssues] = useState<IssueOut[]>([]);
  const [runnerAckIds, setRunnerAckIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Refs used by the poller so we always read the latest "pause" flags
  const pausePollingRef = useRef(false);
  const hasAnyIssueOpenRef = useRef(false);

  async function load() {
    if (!orderCode) return;
    if (pausePollingRef.current || hasAnyIssueOpenRef.current) return;

    try {
      setErr(null);
      // NOTE: we now call /api/orders/by-code instead of /api/status
      const r = await fetch(`/api/orders/by-code?code=${encodeURIComponent(orderCode)}`, {
        cache: "no-store",
      });
      const j: StatusPayload = await r.json();
      if (!r.ok || !j.ok) throw new Error((j as any).error || "Failed to load");

      setTickets(j.tickets ?? []);
      setClosedAt(j.closed_at ?? null);
      setTableNumber(j.table_number ?? null);
      setCustomerConfirmedAt(j.customer_confirmed_at ?? null);
      setResolutionRequired(Boolean(j.resolution_required));
      setIssues(Array.isArray(j.issues) ? j.issues : []);
      setRunnerAckIds(Array.isArray(j.runner_ack_ticket_ids) ? j.runner_ack_ticket_ids : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // Polling (reads refs, so it respects "pause while form is open")
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderCode]);

  const allDelivered = useMemo(
    () => tickets.length > 0 && tickets.every((t) => t.status === "delivered" || t.status === "completed"),
    [tickets]
  );
  const needsCustomerConfirm = allDelivered && !resolutionRequired && !customerConfirmedAt;

  async function handleDeliveredConfirmed() {
    try {
      const resp = await fetch("/api/orders/client-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code: orderCode }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j?.error || "Failed to confirm");
      await load();
      onClosed();
    } catch (e: any) {
      alert(e?.message || "Failed to confirm");
    }
  }

  async function handleClientAckFixed(ticketId: number) {
    try {
      const res = await fetch("/api/issues/client-ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code: orderCode, ticket_id: ticketId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "Failed to confirm");

      // Immediately confirm the order to satisfy close condition
      await fetch("/api/orders/client-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code: orderCode }),
      }).catch(() => {});

      await load();
      onClosed();
    } catch (e: any) {
      alert(e?.message || "Failed to confirm");
    }
  }

  const food = tickets.find((t) => t.stream === "food");
  const drinks = tickets.find((t) => t.stream === "drinks");

  return (
    <section className="rounded-2xl border p-4 bg-white">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-lg font-bold">Order {orderCode}</div>
        {tableNumber != null && (
          <div className="ml-3 rounded-full border px-3 py-1 text-sm">
            Table <span className="font-semibold">{tableNumber}</span>
          </div>
        )}
      </div>

      {resolutionRequired && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <div className="font-medium">We’re working on your issue</div>
          <div className="text-sm">A runner will check on you shortly.</div>
        </div>
      )}

      {needsCustomerConfirm && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
          <div className="font-medium">Your order has arrived 🎉</div>
          <div className="text-sm mt-1">
            Please confirm everything’s OK. If anything’s wrong, use the Food/Drinks cards to report an issue.
          </div>
          <div className="mt-3">
            <button
              onClick={handleDeliveredConfirmed}
              className="rounded-lg border bg-black text-white px-3 py-2 text-sm"
            >
              Everything’s OK
            </button>
          </div>
        </div>
      )}

      {!needsCustomerConfirm && !!closedAt && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
          Order complete — closed at {new Date(closedAt).toLocaleTimeString()}.
        </div>
      )}

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>}

      {loading ? (
        <div className="grid gap-4">
          <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            orderCode={orderCode}
            t={food}
            title="Food"
            anchorId={`card-food-${orderCode}`}
            onReload={load}
            issues={issues}
            runnerAckIds={runnerAckIds}
            pausePollingRef={pausePollingRef}
            hasAnyIssueOpenRef={hasAnyIssueOpenRef}
            onClientAckFixed={handleClientAckFixed}
          />
          <Card
            orderCode={orderCode}
            t={drinks}
            title="Drinks"
            anchorId={`card-drinks-${orderCode}`}
            onReload={load}
            issues={issues}
            runnerAckIds={runnerAckIds}
            pausePollingRef={pausePollingRef}
            hasAnyIssueOpenRef={hasAnyIssueOpenRef}
            onClientAckFixed={handleClientAckFixed}
          />
        </div>
      )}
    </section>
  );
}

/** Standalone Card so it keeps its own state across parent re-renders */
function Card({
  orderCode,
  t,
  title,
  anchorId,
  onReload,
  issues,
  runnerAckIds,
  pausePollingRef,
  hasAnyIssueOpenRef,
  onClientAckFixed,
}: {
  orderCode: string;
  t?: Ticket;
  title: string;
  anchorId: string;
  onReload: () => Promise<void> | void;
  issues: IssueOut[];
  runnerAckIds: number[];
  pausePollingRef: React.MutableRefObject<boolean>;
  hasAnyIssueOpenRef: React.MutableRefObject<boolean>;
  onClientAckFixed: (ticketId: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // While the form is open, pause polling globally for this order panel
  useEffect(() => {
    hasAnyIssueOpenRef.current = open;
    pausePollingRef.current = open;
    return () => {
      hasAnyIssueOpenRef.current = false;
      pausePollingRef.current = false;
    };
  }, [open, hasAnyIssueOpenRef, pausePollingRef]);

  const defaultType = t ? ISSUE_TYPES_BY_STREAM[t.stream][0].value : "other";
  const [sel, setSel] = useState<string>(defaultType);
  const [text, setText] = useState("");

  // Reset the form when ticket identity or stream changes
  useEffect(() => {
    if (t && !open) {
      setSel(ISSUE_TYPES_BY_STREAM[t.stream][0].value);
      setText("");
      setDone(false);
    }
  }, [t?.id, t?.stream, open]);

  async function submitIssue() {
    if (!t) return;
    try {
      setBusy(true);
      const res = await fetch("/api/issues/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_code: orderCode,
          ticket_id: t.id,
          type: sel,
          description: text.trim() || null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Issue submission failed");

      setDone(true);
      setOpen(false);
      pausePollingRef.current = false;
      hasAnyIssueOpenRef.current = false;
      await onReload();
    } catch (e: any) {
      alert(e?.message || "Issue submission failed");
    } finally {
      setBusy(false);
    }
  }

  const showAckPrompt = (() => {
    if (!t) return false;
    const isDelivered = t.status === "delivered" || t.status === "completed";
    const ackOnThisTicket = runnerAckIds.includes(t.id);
    const ackOnSameStream = issues.some(
      (i) => i.status === "runner_ack" && i.ticket_id == null && i.stream === t.stream
    );
    const ackOrderWide = issues.some(
      (i) => i.status === "runner_ack" && i.ticket_id == null && i.stream == null
    );
    return isDelivered && (ackOnThisTicket || ackOnSameStream || ackOrderWide);
  })();

  return (
    <div id={anchorId} className="rounded-2xl border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-lg font-semibold">{title}</div>
        {t ? <Badge status={t.status} /> : <span className="text-sm text-gray-500">n/a</span>}
      </div>

      {t?.items && t.items.length > 0 ? (
        <ul className="mb-2 list-none p-0 text-sm text-gray-800">
          {t.items.map((li, i) => (
            <li key={i} className="flex items-center justify-between">
              <span>{li.name}</span>
              <span className="font-medium">×{li.qty}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-gray-500 text-sm mb-2">No items in this stream.</div>
      )}

      {!t ? (
        <div className="text-gray-500 text-sm">—</div>
      ) : t.status === "delivered" || t.status === "completed" ? (
        <>
          <div className="text-emerald-700 font-medium mb-2">Delivered ✅</div>

          {showAckPrompt && (
            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-900">
              <div className="font-medium">Runner brought a fix</div>
              <div className="text-sm mt-1">Is everything okay now for your {t.stream}?</div>
              <div className="mt-2">
                <button
                  onClick={() => onClientAckFixed(t.id)}
                  className="rounded-lg border bg-black text-white px-3 py-2 text-sm hover:opacity-90"
                >
                  Yes, it’s fixed
                </button>
              </div>
            </div>
          )}

          {!done && !t.has_issue ? (
            !open ? (
              <button
                className="rounded-xl border px-3 py-2 text-sm"
                onClick={() => setOpen(true)}
              >
                Report an issue
              </button>
            ) : (
              <div className="mt-2 grid gap-2">
                <select
                  className="rounded-lg border px-3 py-2 text-sm"
                  value={sel}
                  onChange={(e) => setSel(e.target.value)}
                  autoFocus
                >
                  {t &&
                    ISSUE_TYPES_BY_STREAM[t.stream].map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                </select>
                <textarea
                  className="rounded-lg border px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Describe the issue (optional)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="rounded-xl bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
                    disabled={busy}
                    onClick={submitIssue}
                  >
                    {busy ? "Submitting…" : "Submit"}
                  </button>
                  <button
                    className="rounded-xl border px-3 py-2 text-sm"
                    onClick={() => {
                      setOpen(false);
                      pausePollingRef.current = false;
                      hasAnyIssueOpenRef.current = false;
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="text-sm text-emerald-700">Issue submitted. Thank you.</div>
          )}
        </>
      ) : t.status === "ready" ? (
        <div className="text-amber-700">Ready — runner on the way</div>
      ) : t.status === "preparing" ? (
        <div className="text-sky-700">Being prepared</div>
      ) : (
        <div className="text-gray-700">Order received</div>
      )}
    </div>
  );
}
