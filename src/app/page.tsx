// src/app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [table, setTable] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const n = parseInt(table, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Please enter a valid table number.");
      return;
    }

    // Save table for the Menu page to read
    try {
      localStorage.setItem("kwik.table", String(n));
    } catch {}

    // Navigate to Menu (hard redirect fallback for resilience)
    router.push("/menu");
    // setTimeout(() => { window.location.href = "/menu"; }, 0); // <-- uncomment if needed
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">KwikOrder</h1>
        <p className="text-sm text-gray-600">Fast, simple table-side ordering.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Guests */}
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold mb-2">I’m a Guest</h2>
          <p className="text-sm text-gray-600 mb-4">
            Enter your table number to open the menu.
          </p>

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="Table #"
              className="w-32 rounded-lg border px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
              disabled={!table}
            >
              Continue
            </button>
          </form>
          {err && <div className="mt-2 text-sm text-red-600">{err}</div>}

          <div className="mt-3 text-xs text-gray-500">
            (Later, QR codes will take you here automatically.)
          </div>
        </section>

        {/* Staff */}
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold mb-2">Staff Portal</h2>
          <p className="text-sm text-gray-600 mb-4">Choose your station.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/kitchen" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Kitchen</a>
            <a href="/bar" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Bar</a>
            <a href="/runner" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Runner</a>
            <a href="/admin" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Admin</a>
          </div>
        </section>
      </div>
    </main>
  );
}
