import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const env = {
    urlPresent: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    if (!env.urlPresent || !env.hasService) {
      return res.status(500).json({ ok: false, env, error: "Missing Supabase URL or SERVICE ROLE KEY" });
    }

    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const ogQ = await s.from("order_groups").select("id", { count: "exact", head: true });
    const tkQ = await s.from("tickets").select("id", { count: "exact", head: true });
    const isQ = await s.from("issues").select("id", { count: "exact", head: true });
    const rq  = await s.from("runner_queue").select("*").limit(5);

    return res.status(200).json({
      ok: true,
      env,
      counts: {
        order_groups: ogQ.count ?? null,
        tickets: tkQ.count ?? null,
        issues: isQ.count ?? null,
      },
      runner_queue_sample: rq.data ?? [],
      errors: {
        order_groups: ogQ.error?.message ?? null,
        tickets: tkQ.error?.message ?? null,
        issues: isQ.error?.message ?? null,
        runner_queue: rq.error?.message ?? null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, env, error: e?.message || String(e) });
  }
}
