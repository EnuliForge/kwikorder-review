// src/app/status/page.tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";

type ActiveOrder = {
  id: number;
  order_code: string;
  table_number: number | null;
  created_at: string;
  resolution_required: boolean;
};

// Build an absolute URL for server-side fetches
function absUrl(path: string) {
  const h = headers();
  const forwardedHost = h.get("x-forwarded-host");
  const host = forwardedHost ?? h.get("host") ?? "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto =
    forwardedProto ??
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const base =
    process.env.NEXT_PUBLIC_BASE_URL && process.env.NEXT_PUBLIC_BASE_URL.trim().length > 0
      ? process.env.NEXT_PUBLIC_BASE_URL
      : `${proto}://${host}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getActiveOrdersForTable(table: number): Promise<ActiveOrder[]> {
  const url = absUrl(`/api/orders/active-for-table?table=${encodeURIComponent(String(table))}`);
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j?.error || "Failed to load active orders");
  return j.orders as ActiveOrder[];
}

// NOTE: searchParams is now async in Next 15
export default async function StatusRouter({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const oc = (sp?.oc ?? sp?.order_code) as string | undefined;
  if (oc) {
    redirect(`/status/${encodeURIComponent(oc)}`);
  }

  const tableParam = sp?.table as string | undefined;
  if (!tableParam) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold mb-3">Status</h1>
        <div className="rounded-lg border bg-white p-4">
          No order selected.
          <div className="mt-3">
            <a href="/menu" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
              Back to Menu
            </a>
          </div>
        </div>
      </main>
    );
  }

  const table = Number(tableParam);
  if (!Number.isFinite(table)) redirect("/status");

  const orders = await getActiveOrdersForTable(table);

  if (orders.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold mb-3">Status</h1>
        <div className="rounded-lg border bg-white p-4">
          No active orders for table <span className="font-semibold">{table}</span>.
          <div className="mt-3">
            <a href="/menu" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
              Back to Menu
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (orders.length === 1) {
    redirect(`/status/${encodeURIComponent(orders[0].order_code)}`);
  }

  // Multiple active orders → chooser
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-3">Select an order</h1>
      <ul className="grid gap-3">
        {orders.map((o) => (
          <li key={o.id} className="rounded-2xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">
                Order {o.order_code}
                {o.table_number != null && (
                  <span className="ml-2 rounded-full border px-2 py-0.5 text-sm">
                    Table {o.table_number}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600">
                {new Date(o.created_at).toLocaleTimeString()}
              </div>
            </div>
            {o.resolution_required && (
              <div className="mt-1 text-sm text-amber-700">Issue flagged</div>
            )}
            <div className="mt-3">
              <a
                href={`/status/${encodeURIComponent(o.order_code)}`}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
              >
                View status
              </a>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
