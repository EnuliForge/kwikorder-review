"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function StartPage() {
  const router = useRouter();
  const [table, setTable] = useState("");

  useEffect(() => {
    try {
      const t = localStorage.getItem("kwik.table");
      if (t) setTable(t);
    } catch {}
  }, []);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(table, 10);
    if (!Number.isFinite(n) || n <= 0) {
      alert("Enter a valid table number");
      return;
    }
    try { localStorage.setItem("kwik.table", String(n)); } catch {}
    router.push(`/menu?table=${n}`);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold mb-4">Welcome to KwikOrder</h1>

      <form onSubmit={go} className="space-y-3">
        <label className="block text-sm font-medium">Enter table number</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="e.g. 12"
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="w-full rounded-lg border px-3 py-2"
        />
        <button className="w-full rounded-lg bg-black text-white px-4 py-2">
          Continue
        </button>
      </form>

      {/* Staff shortcuts */}
      <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
        <a href="/kitchen" className="rounded-lg border px-3 py-2 hover:bg-gray-50">Kitchen</a>
        <a href="/bar"     className="rounded-lg border px-3 py-2 hover:bg-gray-50">Bar</a>
        <a href="/runner"  className="rounded-lg border px-3 py-2 hover:bg-gray-50">Runner</a>
        <a href="/admin"   className="rounded-lg border px-3 py-2 hover:bg-gray-50">Admin</a>
      </div>
    </main>
  );
}
