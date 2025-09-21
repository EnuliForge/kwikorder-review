"use client";
import { createContext, useContext, useMemo, useState, ReactNode } from "react";

export type CartLine = { id: number | string; name: string; price: number; stream: "food" | "drinks"; qty: number };

type CartCtx = {
  items: CartLine[];
  add: (it: Omit<CartLine, "qty">, delta?: number) => void;
  inc: (id: CartLine["id"]) => void;
  dec: (id: CartLine["id"]) => void;
  remove: (id: CartLine["id"]) => void;   // ⬅️ new
  total: number;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
export const useCart = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart must be used within <CartProvider>");
  return v;
};

export default function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);

  const add = (it: Omit<CartLine, "qty">, delta = 1) =>
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === it.id);
      if (i === -1) return [...xs, { ...it, qty: Math.max(1, delta) }];
      const copy = [...xs];
      copy[i] = { ...copy[i], qty: copy[i].qty + delta };
      return copy.filter((x) => x.qty > 0);
    });

  const inc = (id: CartLine["id"]) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, qty: x.qty + 1 } : x)));
  const dec = (id: CartLine["id"]) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0));

  const remove = (id: CartLine["id"]) => setItems((xs) => xs.filter((x) => x.id !== id));  // ⬅️ new

  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);
  const clear = () => setItems([]);

  const value = useMemo(() => ({ items, add, inc, dec, remove, total, clear }), [items, total]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
