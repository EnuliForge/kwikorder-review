"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Ticket = {
  id: number;
  order_group_id: number;
  stream: "food" | "drinks";
  status: "received" | "preparing" | "ready" | "delivered" | "completed" | "cancelled";
  created_at: string;
  order_groups?: { order_code: string; table_number: number | null } | null;
};

type Group = {
  order_code: string;
  table_number: number | null;
  tickets: Ticket[];
};

type IssueRow = {
  id: number;
  order_group_id: number;
  ticket_id: number | null;
  status: "open" | "runner_ack" | "client_ack" | "resolved";
  type: string | null;
  description: string | null;
  created_at: string;
  // joined
  order_groups?: { order_code: string; table_number: number | null } | null;
  tickets?: { stream: "food" | "drinks" } | null;
};

type IssueGroup = {
  order_code: string;
  table_number: number | null;
  issues: Array<{
    id: number;
    stream: "food" | "drinks" | null;
    type: string | null;
    description: string | null;
    status: IssueRow["status"];
    created_at: string;
  }>;
  hasRunnerAck: boolean;
};

function makeSupa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function RunnerPage() {
  const supa = useMemo(makeSupa, []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [issues, setIssues] = useState<IssueGroup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyDeliver, setBusyDeliver] = useState<number | null>(null);
  const [busyAck, setBusyAck] = useState<string | null>(null); // order_code
  const [banner, setBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setErr(null);

    // A) Ready tickets (to deliver)
    const { data: ticketsData, error: tErr } = await supa
      .from("tickets")
      .select(
        "id, order_group_id, stream, status, created_at, order_groups(order_code, table_number)"
      )
      .in("status", ["ready"])
      .order("created_at", { ascending: true });

    if (tErr) {
      setErr(tErr.message);
      setGroups([]);
    } else {
      const byOrder = new Map<string, Group>();
      for (const t of (ticketsData || []) as Ticket[]) {
        const oc = t.order_groups?.order_code || `OG-${t.order_group_id}`;
        const table = t.order_groups?.table_number ?? null;
        if (!byOrder.has(oc)) byOrder.set(oc, { order_code: oc, table_number: table, tickets: [] });
        byOrder.get(oc)!.tickets.push(t);
      }
      let all = Array.from(byOrder.values());
      if (search.trim()) {
        const q = search.toLowerCase();
        all = all.filter((g) => {
          const codeHit = g.order_code.toLowerCase().includes(q);
          const tableHit = g.table_number !== null && String(g.table_number).includes(q);
          return codeHit || tableHit;
        });
      }
      setGroups(all);
    }

    // B) Unresolved issues (show details)
    const { data: issuesData, error: iErr } = await supa
      .from("issues")
      .select(
        "id, order_group_id, ticket_id, status, type, description, created_at, order_groups(order_code, table_number), tickets(stream)"
      )
      .neq("status", "resolved")
      .order("created_at", { ascending: true });

    if (iErr) {
      setErr((prev) => prev || iErr.message);
      setIssues([]);
    } else {
      const byOrder = new Map<string, IssueGroup>();
      for (const row of (issuesData || []) as IssueRow[]) {
        const oc = row.order_groups?.order_code || `OG-${row.order_group_id}`;
        const table = row.order_groups?.table_number ?? null;
        const g =
          byOrder.get(oc) ||
          { order_code: oc, table_number: table, issues: [], hasRunnerAck: false };
        g.issues.push({
          id: row.id,
          stream: row.tickets?.stream ?? null,
          type: row.type,
          description: row.description,
          status: row.status,
          created_at: row.created_at,
        });
        if (row.status === "runner_ack") g.hasRunnerAck = true;
        byOrder.set(oc, g);
      }
      let list = Array.from(byOrder.values());
      if (search.trim()) {
        const q = search.toLowerCase();
        list = list.filter((g) => {
          const codeHit = g.order_code.toLowerCase().includes(q);
          const tableHit = g.table_number !== null && String(g.table_number).includes(q);
          return codeHit || tableHit;
        });
      }
      // Sort: non-acked first (need attention), then by newest issue
      list.sort((a, b) => {
        if (a.hasRunnerAck !== b.hasRunnerAck) return a.hasRunnerAck ? 1 : -1;
        const aLatest = a.issues[a.issues.length - 1]?.created_at || "";
        const bLatest = b.issues[b.issues.length - 1]?.created_at || "";
        return bLatest.localeCompare(aLatest);
      });
      setIssues(list);
    }
  }

  useEffect(() => {
    load();
    const ch = supa
      .channel("runner_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => load())
      .subscribe();
    return () => { supa.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supa]);

  async function deliver(ticketId: number) {
    setBusyDeliver(ticketId);
    try {
      const r = await fetch("/api/tickets/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId, status: "delivered" }),
      });
      if (!r.ok) throw new Error(await r.text());
      setBanner("Delivered ✔");
      setTimeout(() => setBanner(null), 1500);
    } catch (e: any) {
      setErr(e?.message || "Failed to deliver");
    } finally {
      setBusyDeliver(null);
      load();
    }
  }

  async function runnerAckFix(order_code: string) {
    setBusyAck(order_code);
    try {
      const r = await fetch("/api/issues/runner-resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_code, mode: "runner_ack" }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(text || "Failed");
      setBanner(`Marked fix en route for ${order_code}`);
      setTimeout(() => setBanner(null), 1500);
    } catch (e: any) {
      setErr(e?.message || "Failed to acknowledge");
    } finally {
      setBusyAck(null);
      load();
    }
  }

  function IssueBadge({ status }: { status: IssueRow["status"] }) {
    const map: Record<IssueRow["status"], string> = {
      open: "bg-amber-100 text-amber-800",
      runner_ack: "bg-sky-100 text-sky-800",
      client_ack: "bg-purple-100 text-purple-800",
      resolved: "bg-emerald-100 text-emerald-800",
    };
    return <span className={`text-xs px-2 py-1 rounded-full capitalize ${map[status]}`}>{status.replace("_"," ")}</span>;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Runner</h1>
        <nav className="hidden md:flex items-center gap-2">
          <a href="/kitchen" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Kitchen</a>
          <a href="/bar" className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">Bar</a>
        </nav>
      </header>

      {banner && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
          {banner}
        </div>
      )}
      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by order code or table #"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <button onClick={load} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {/* Section A: Ready to deliver */}
      <h2 className="text-lg font-semibold mb-2">Ready to deliver</h2>
      {groups.length === 0 ? (
        <div className="mb-6 rounded-xl border p-4 text-sm text-gray-600">No ready tickets.</div>
      ) : (
        <div className="mb-6 grid gap-4">
          {groups.map((g) => (
            <div key={g.order_code} className="rounded-2xl border p-4 bg-white">
              <div className="font-semibold">
                Table {g.table_number ?? "—"} • <span className="font-mono">{g.order_code}</span>
              </div>
              <div className="mt-3 grid gap-2">
                {g.tickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="text-sm">#{String(t.id).slice(-4)} • {t.stream}</div>
                    <button
                      onClick={() => deliver(t.id)}
                      disabled={busyDeliver === t.id}
                      className="rounded-lg border bg-black text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-60"
                    >
                      {busyDeliver === t.id ? "Delivering…" : "Mark delivered"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section B: Issues to handle */}
      <h2 className="text-lg font-semibold mb-2">Issues to handle</h2>
      {issues.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-gray-600">No unresolved issues.</div>
      ) : (
        <div className="grid gap-4">
          {issues.map((g) => (
            <div key={g.order_code} className="rounded-2xl border p-4 bg-white">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  Table {g.table_number ?? "—"} • <span className="font-mono">{g.order_code}</span>
                </div>
                {/* no "Open status" link */}
              </div>

              {/* issue list */}
              <ul className="mt-3 space-y-2">
                {g.issues.map((it) => (
                  <li key={it.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium capitalize">{it.stream ?? "unknown"}</span>
                        {" • "}
                        <span className="capitalize">{(it.type || "").replace("_"," ") || "issue"}</span>
                        {it.description ? <> — <span className="text-gray-600">{it.description}</span></> : null}
                      </div>
                      <IssueBadge status={it.status} />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => runnerAckFix(g.order_code)}
                  disabled={busyAck === g.order_code}
                  className="text-sm rounded-lg border bg-black text-white px-3 py-2 hover:opacity-90 disabled:opacity-60"
                  title="Let the customer know you're bringing the fix"
                >
                  {busyAck === g.order_code ? "Notifying…" : "Runner bringing fix"}
                </button>
                {/* no "Open status" button */}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
