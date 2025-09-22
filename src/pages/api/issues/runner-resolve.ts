// src/pages/api/issues/runner-resolve.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Mode = "runner_ack" | "resolve";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { order_code, mode }: { order_code?: string; mode?: Mode } = req.body || {};
    if (!order_code) {
      return res.status(400).json({ ok: false, error: "order_code required" });
    }
    const op: Mode = mode === "resolve" ? "resolve" : "runner_ack";

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only key
      { auth: { persistSession: false } }
    );

    // Find order group
    const { data: og, error: ogErr } = await supa
      .from("order_groups")
      .select("id")
      .eq("order_code", order_code)
      .maybeSingle();

    if (ogErr) return res.status(500).json({ ok: false, error: ogErr.message });
    if (!og)   return res.status(404).json({ ok: false, error: "order not found" });

    const now = new Date().toISOString();

    if (op === "resolve") {
      const { data: updated, error } = await supa
        .from("issues")
        .update({ status: "resolved", resolved_at: now })
        .eq("order_group_id", og.id)
        .neq("status", "resolved")
        .select("id");

      if (error) return res.status(500).json({ ok: false, error: error.message });

      const { error: flagErr } = await supa
        .from("order_groups")
        .update({ resolution_required: false })
        .eq("id", og.id);
      if (flagErr) return res.status(500).json({ ok: false, error: flagErr.message });

      return res.status(200).json({ ok: true, resolved_count: (updated || []).length });
    }

    // Default: runner_ack
    const { data: updated, error } = await supa
      .from("issues")
      .update({ status: "runner_ack" })
      .eq("order_group_id", og.id)
      .neq("status", "resolved")
      .select("id");

    if (error) return res.status(500).json({ ok: false, error: error.message });

    // Ensure banner is visible on Status
    const { error: flagErr } = await supa
      .from("order_groups")
      .update({ resolution_required: true })
      .eq("id", og.id);
    if (flagErr) return res.status(500).json({ ok: false, error: flagErr.message });

    return res.status(200).json({ ok: true, runner_ack_count: (updated || []).length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
