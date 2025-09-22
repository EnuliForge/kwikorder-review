"use client";
import { memo, use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ----------------------------- Types ----------------------------- */
type LineItem = { name: string; qty: number };

type Ticket = {
  id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "cancelled" | "delivered" | "completed";
  delivered_at: string | null;
  ready_at?: string | null;
  created_at?: string;
  items?: LineItem[];
  has_issue?: boolean; // server tells us if an active issue exists for this ticket
};

type IssueLite = { status: "open" | "runner_ack" | "client_ack" | "resolved" };

type StatusPayload = {
  ok: boolean;
  tickets: Ticket[];
  closed_at: string | null;
  customer_confirmed_at?: string | null;
  resolution_required?: boolean;
  has_runner_ack?: boolean;
  issues?: IssueLite[];
  table_number?: number | null; // ⬅️ ensure type includes this
};

/* -------------------------- UI Constants ------------------------- */
const ISSUE_TYPES_BY_STREAM: Record<"food" | "drinks", { value: string; label: string }[]> = {
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

/* ---------------------------- Page ------------------------------- */
export default function StatusPage({ params }: { params: Promise<{ order_code: string }> }) {
  const { order_code } = use(params);
  const router = useRouter();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [customerConfirmedAt, setCustomerConfirmedAt] = useState<string | null>(null);

  const [resolutionRequired, setResolutionRequired] = useState<boolean>(false);
  const [hasRunnerAck, setHasRunnerAck] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // freeze polling while any issue form is open (prevents focus loss)
  const [pausePolling, setPausePolling] = useState(false);
  const hasAnyIssueOpenRef = useRef(false);

  // client confirm modal (when runner sets runner_ack)
  const askedThisSessionRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // delivered panel confirm state
  const [deliveredConfirmBusy, setDeliveredConfirmBusy] = useState(false);

  async function load() {
    if (pausePolling || hasAnyIssueOpenRef.current) return;
    try {
      setErr(null);
      const r = await fetch(`/api/status?order_code=${encodeURIComponent(order_code)}`, { cache: "no-store" });
      const j: StatusPayload = await r.json();
      if (!j.ok) throw new Error((j as any).error || "Failed to load");

      if (!pausePolling && !hasAnyIssueOpenRef.current) {
        setTickets(j.tickets ?? []);
        setClosedAt(j.closed_at ?? null);
        setTableNumber(j.table_number ?? null);
        setCustomerConfirmedAt((j as any).customer_confirmed_at ?? null);

        const rr = Boolean((j as any).resolution_required);
        const runnerAck =
          Boolean((j as any).has_runner_ack) ||
          (Array.isArray(j.issues) && j.issues.some((it) => it.status === "runner_ack"));
        setResolutionRequired(rr);
        setHasRunnerAck(runnerAck);
      }
    } catch (e: any) {
      if (!pausePolling && !hasAnyIssueOpenRef.current) setErr(e?.message || "Failed to load");
    } finally {
      if (!pausePolling && !hasAnyIssueOpenRef.current) setLoading(false);
    }
  }

  // poller
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 4000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order_code]);

  const allDelivered =
    tickets.length > 0 && tickets.every((t) => t.status === "delivered" || t.status === "completed");
  const needsCustomerConfirm = allDelivered && !resolutionRequired && !customerConfirmedAt;
  const showCompleteBanner = allDelivered && !resolutionRequired && !!customerConfirmedAt;

  // show client-fix modal if runner acked (once per session)
  useEffect(() => {
    if (!askedThisSessionRef.current && hasRunnerAck) {
      setConfirmOpen(true);
      askedThisSessionRef.current = true;
    }
  }, [hasRunnerAck]);

  /* ----------------- End session + idle auto-return ----------------- */
  function endSession() {
    try { localStorage.removeItem("kwik.table"); } catch {}
    router.replace("/start");
  }

  // 15m idle -> only when truly safe (all delivered + no issues + customer confirmed)
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    const bump = () => { lastActiveRef.current = Date.now(); };
    const evs: (keyof WindowEventMap)[] = ["click", "keydown", "touchstart", "scroll", "visibilitychange"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true } as any));

    const t = setInterval(() => {
      const idleMs = Date.now() - lastActiveRef.current;
      const canLeave = showCompleteBanner; // derived: all delivered, no issues, and customer confirmed
      if (canLeave && idleMs >= 15 * 60 * 1000) {
        endSession();
      }
    }, 60 * 1000);

    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump as any));
      clearInterval(t);
    };
  }, [showCompleteBanner]);

  /* ---------------------- Delivered confirmation ---------------------- */
  async function handleDeliveredConfirmed() {
    try {
      setDeliveredConfirmBusy(true);
      const resp = await fetch("/api/orders/client-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.ok) throw new Error(j?.error || "Failed to confirm");
      router.replace(`/menu?oc=${encodeURIComponent(order_code)}`);
    } catch (e: any) {
      alert(e?.message || "Failed to confirm");
    } finally {
      setDeliveredConfirmBusy(false);
    }
  }

  /* -------------------- Runner-ack fix confirmation ------------------- */
  async function handleClientConfirmFixed() {
    try {
      setConfirmBusy(true);
      const res = await fetch("/api/issues/client-ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code }),
      });
      const j = await res.json().catch(() => ({}));
      setConfirmOpen(false);
      if (j?.redirect_to_menu) {
        router.replace(`/menu?oc=${encodeURIComponent(order_code)}`);
      } else {
        await load();
      }
    } catch {
      setConfirmOpen(false);
      await load();
    } finally {
      setConfirmBusy(false);
    }
  }

  /* ------------------------- Ticket Card ------------------------- */
  const Card = memo(function Card({
    t,
    title,
    anchorId,
    reload,
  }: {
    t?: Ticket;
    title: string;
    anchorId: string;
    reload: () => Promise<void> | void;
  }) {
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    const defaultType = t ? ISSUE_TYPES_BY_STREAM[t.stream][0].value : "other";
    const [sel, setSel] = useState<string>(defaultType);
    const [text, setText] = useState("");

    useEffect(() => {
      hasAnyIssueOpenRef.current = open;
      return () => {
        hasAnyIssueOpenRef.current = false;
      };
    }, [open]);

    useEffect(() => {
      if (t && !open) {
        setSel(ISSUE_TYPES_BY_STREAM[t.stream][0].value);
        setText("");
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
            order_code,
            ticket_id: t.id,
            type: sel,
            description: text.trim() || null,
          }),
        });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || "Issue submission failed");

        // Close form, stay on page, and refresh state (banner + has_issue)
        setDone(true);
        setOpen(false);
        setPausePolling(false);
        hasAnyIssueOpenRef.current = false;

        await reload();
      } catch (e: any) {
        alert(e?.message || "Issue submission failed");
      } finally {
        setBusy(false);
      }
    }

    return (
      <div id={anchorId} className="rounded-2xl border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          {t ? <Badge status={t.status} /> : <span className="text-sm text-gray-500">n/a</span>}
        </div>

        {/* items */}
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

        {/* status + issues */}
        {!t ? (
          <div className="text-gray-500 text-sm">—</div>
        ) : t.status === "delivered" || t.status === "completed" ? (
          <>
            <div className="text-emerald-700 font-medium mb-2">Delivered ✅</div>
            {!done && !t.has_issue ? (
              !open ? (
                <button
                  className="rounded-xl border px-3 py-2 text-sm"
                  onClick={() => {
                    setOpen(true);
                    setPausePolling(true);
                    hasAnyIssueOpenRef.current = true;
                  }}
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
                        setPausePolling(false);
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
  });

  const food = tickets.find((t) => t.stream === "food");
  const drinks = tickets.find((t) => t.stream === "drinks");

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Order {order_code}</h1>
          {tableNumber != null && (
            <div className="rounded-full border px-3 py-1 text-sm">
              Table <span className="font-semibold">{tableNumber}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/menu?oc=${encodeURIComponent(order_code)}`}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Back to Menu
          </a>
          <button
            onClick={endSession}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            title="Clear table and return to start"
          >
            End session
          </button>
        </div>
      </header>

      {/* amber banner while any issue is open */}
      {resolutionRequired && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <div className="font-medium">We’re working on your issue</div>
          <div className="text-sm">A runner will check on you shortly.</div>
        </div>
      )}

      {/* Delivered confirmation panel (no extra Report button; per-card handles that) */}
      {needsCustomerConfirm && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
          <div className="font-medium">Your order has arrived 🎉</div>
          <div className="text-sm mt-1">
            Please confirm everything’s OK. If anything’s wrong, use the Food/Drinks cards to report an issue.
          </div>
          <div className="mt-3">
            <button
              onClick={handleDeliveredConfirmed}
              disabled={deliveredConfirmBusy}
              className="rounded-lg border bg-black text-white px-3 py-2 text-sm disabled:opacity-60"
            >
              {deliveredConfirmBusy ? "Working…" : "Everything’s OK"}
            </button>
          </div>
        </div>
      )}

      {/* green banner ONLY after customer has confirmed */}
      {showCompleteBanner && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
          Order complete{closedAt ? ` — closed at ${new Date(closedAt).toLocaleTimeString()}` : ""}.
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
          <Card t={food} title="Food" anchorId="card-food" reload={load} />
          <Card t={drinks} title="Drinks" anchorId="card-drinks" reload={load} />
        </div>
      )}

      {/* Client confirmation modal (appears when runner has acknowledged a fix) */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full sm:w-[460px] rounded-t-2xl sm:rounded-2xl p-5">
            <div className="text-lg font-semibold mb-1">All sorted?</div>
            <p className="text-sm text-gray-600 mb-4">
              The runner marked your issue as fixed. Please confirm everything is okay on your side.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border hover:bg-gray-50"
                disabled={confirmBusy}
              >
                Not yet
              </button>
              <button
                onClick={handleClientConfirmFixed}
                className="px-3 py-2 text-sm rounded-lg border bg-black text-white hover:opacity-90 disabled:opacity-60"
                disabled={confirmBusy}
              >
                {confirmBusy ? "Working…" : "Yes, it’s fixed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
