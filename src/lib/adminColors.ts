export type TableOrderLite = {
  order_code: string;
  closed_at: string | null;
  resolution_required: boolean;
};

export const COLOR_CLASSES = {
  white:  "bg-white border-gray-200 text-gray-900",
  orange: "bg-orange-50 border-orange-300 text-orange-900",
  green:  "bg-emerald-50 border-emerald-300 text-emerald-900",
  red:    "bg-red-50 border-red-300 text-red-900",
  purple: "bg-purple-50 border-purple-300 text-purple-900",
} as const;

export type ColorKey = keyof typeof COLOR_CLASSES;

/** Back-compat: uses only ACTIVE orders (no 'green' state here). */
export function getTableStatusColorAndLabel(orders: TableOrderLite[]): { color: ColorKey; label: string } {
  const active = orders.filter(o => !o.closed_at);
  const hasIssue = active.some(o => o.resolution_required);

  if (active.length === 0) return { color: "white", label: "No orders" };
  if (hasIssue)            return { color: "red",   label: "Order issue" };
  if (active.length >= 2)  return { color: "purple",label: "Multiple orders" };
  return { color: "orange", label: "Order present" };
}

/** New: considers active + recently-closed to support table-level 'green'. */
export function getTableSummaryColorAndLabel(
  active: TableOrderLite[],
  recentClosed: TableOrderLite[] = []
): { color: ColorKey; label: string } {
  const activeCount = active.length;
  const hasIssue = active.some(o => o.resolution_required);

  if (activeCount === 0) {
    return recentClosed.length > 0
      ? { color: "green", label: "Orders solved" }
      : { color: "white", label: "No orders" };
  }
  if (hasIssue)           return { color: "red",    label: "Order issue" };
  if (activeCount >= 2)   return { color: "purple", label: "Multiple orders" };
  return { color: "orange", label: "Order present" };
}

/** Per-order color for drill-down rows. */
export function getOrderCardColor(order: TableOrderLite): ColorKey {
  if (order.closed_at)          return "green";
  if (order.resolution_required) return "red";
  return "orange";
}
