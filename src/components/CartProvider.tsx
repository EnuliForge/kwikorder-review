"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type Stream = "food" | "drinks";

export type CartItem = {
  /** May be a synthetic string id for unique lines (e.g., ribeye-uuid) */
  id: string | number;
  /** The original menu item id (numeric) when applicable */
  baseId?: number | string;
  name: string;
  price: number;
  qty: number;
  stream: Stream;
  /** Optional notes (e.g., doneness/side) */
  notes?: string | null;
};

type CartContextShape = {
  items: CartItem[];
  total: number;
  add: (item: CartItem) => void;
  inc: (id: string | number) => void;
  dec: (id: string | number) => void;
  remove: (id: string | number) => void; // ⬅️ NEW
  clear: () => void;
};

const CartCtx = createContext<CartContextShape | null>(null);

export function useCart(): CartContextShape {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

export default function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const add = (newItem: CartItem) => {
    setItems((prev) => {
      // If the id is a string (synthetic), treat as a brand-new line (never merge)
      const isSynthetic = typeof newItem.id === "string";
      if (isSynthetic) {
        return [...prev, { ...newItem, qty: Math.max(1, newItem.qty || 1) }];
      }

      // Merge path for numeric ids (non-configurable items)
      const idx = prev.findIndex((p) => p.id === newItem.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + (newItem.qty || 1) };
        return copy;
      }
      return [...prev, { ...newItem, qty: Math.max(1, newItem.qty || 1) }];
    });
  };

  const inc = (id: string | number) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty: it.qty + 1 } : it))
    );
  };

  const dec = (id: string | number) => {
    setItems((prev) =>
      prev
        .map((it) => (it.id === id ? { ...it, qty: it.qty - 1 } : it))
        .filter((it) => it.qty > 0)
    );
  };

  const remove = (id: string | number) => {
    setItems((prev) => prev.filter((it) => it.id === id ? false : true));
  };

  const clear = () => setItems([]);

  const total = useMemo(
    () => items.reduce((sum, it) => sum + it.qty * it.price, 0),
    [items]
  );

  const value = useMemo(
    () => ({ items, total, add, inc, dec, remove, clear }),
    [items, total]
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
