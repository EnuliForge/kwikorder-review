// src/app/status/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function StatusIndexInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const rawCode = sp?.get("order_code") || sp?.get("code");
    if (rawCode && rawCode.trim()) {
      const code = rawCode.trim().toUpperCase();
      router.replace(`/status/${encodeURIComponent(code)}`);
      return;
    }

    let tableNum: number | null = null;
    const fromUrl = sp?.get("table") || sp?.get("t");
    if (fromUrl) {
      const n = parseInt(fromUrl, 10);
      if (Number.isFinite(n) && n > 0) {
        tableNum = n;
        try { localStorage.setItem("kwik.table", String(n)); } catch {}
      }
    }
    if (tableNum == null) {
      try {
        const saved = localStorage.getItem("kwik.table");
        if (saved) {
          const n = parseInt(saved, 10);
          if (Number.isFinite(n) && n > 0) tableNum = n;
        }
      } catch {}
    }
    if (tableNum != null) {
      router.replace(`/status/table/${tableNum}`);
      return;
    }

    setShowFallback(true);
  }, [router, sp]);

  if (!showFallback) return null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-3 text-2xl font-bold">Order status</h1>
      <p className="mb-4 text-gray-600">We couldn’t determine your order or table from this page.</p>
      <div className="flex gap-2">
        <a href="/start" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Go to Start</a>
        <a href="/menu" className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Back to Menu</a>
      </div>
    </main>
  );
}

export default function StatusIndex() {
  return (
    <Suspense fallback={null}>
      <StatusIndexInner />
    </Suspense>
  );
}
