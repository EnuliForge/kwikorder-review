"use client";
import { memo, use, useEffect, useRef, useState } from "react";

type LineItem = { name: string; qty: number };
type Ticket = {
  id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "cancelled" | "delivered";
  delivered_at: string | null;
  ready_at?: string | null;
  created_at?: string;
  items?: LineItem[];
  has_issue?: boolean; // server tells us if an issue already exists for this ticket
};

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
    ready: "bg-amber-100 text-amber-800",
    preparing: "bg-sky-100 text-sky-800",
    received: "bg-gray-100 text-gray-700",
    cancelled: "bg-red-100 text-red-800",
  };
  return <span className={`px-3 py-1 rounded-full text-sm capitalize ${map[status]}`}>{status}</span>;
}

export default function StatusPage({ params }: { params: Promise<{ order_code: string }> }) {
  const { order_code } = use(params);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // freeze updates while any issue form is open
  const [pausePolling, setPausePolling] = useState(false);
  const hasAnyIssueOpenRef = useRef(false);

  const load = async () => {
    // if a form is open, skip state updates entirely (prevents focus loss)
    if (pausePolling || hasAnyIssueOpenRef.current) return;
    try {
      setErr(null);
      const r = await fetch(`/api/status?order_code=${encodeURIComponent(order_code)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Failed to load");
      if (!pausePolling && !hasAnyIssueOpenRef.current) {
        setTickets(j.tickets ?? []);
        setClosedAt(j.closed_at ?? null);
      }
    } catch (e: any) {
      if (!pausePolling && !hasAnyIssueOpenRef.current) {
        setErr(e?.message || "Failed to load");
      }
    } finally {
      if (!pausePolling && !hasAnyIssueOpenRef.current) setLoading(false);
    }
  };

  // poller (doesn't depend on pause flags; load() guards internally)
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

  const allDelivered = tickets.length > 0 && tickets.every((t) => t.status === "delivered");

  const Card = memo(function Card({ t, title }: { t?: Ticket; title: string }) {
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    // local form state (prevents parent re-render from wiping input)
    const defaultType = t ? ISSUE_TYPES_BY_STREAM[t.stream][0].value : "other";
    const [sel, setSel] = useState<string>(defaultType);
    const [text, setText] = useState("");

    // inform parent if a form is open
    useEffect(() => {
      hasAnyIssueOpenRef.current = open;
      return () => {
        hasAnyIssueOpenRef.current = false;
      };
    }, [open]);

    // reset defaults if the ticket identity changes and form is closed
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

        setDone(true);
        setOpen(false);

        // refresh once to pick up has_issue=true (keeps button muted after reload)
        const r2 = await fetch(`/api/status?order_code=${encodeURIComponent(order_code)}`, { cache: "no-store" });
        const j2 = await r2.json();
        if (j2?.tickets) setTickets(j2.tickets);
      } catch (e: any) {
        alert(e?.message || "Issue submission failed");
      } finally {
        setBusy(false);
        setPausePolling(false);
        hasAnyIssueOpenRef.current = false;
      }
    }

    return (
      <div className="rounded-2xl border bg-white p-4">
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
        ) : t.status === "delivered" ? (
          <>
            <div className="text-emerald-700 font-medium mb-2">Delivered ✅</div>

            {!done && !t.has_issue ? (
              <>
                {!open ? (
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
                )}
              </>
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
      <h1 className="mb-4 text-2xl font-bold">Order {order_code}</h1>

      {tickets.length > 0 && tickets.every((t) => t.status === "delivered") && (
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
          <Card t={food} title="Food" />
          <Card t={drinks} title="Drinks" />
        </div>
      )}
    </main>
  );
}
