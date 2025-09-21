import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function supabaseServer() {
  if (!url || !serviceKey) {
    throw new Error("Supabase URL or SERVICE ROLE KEY missing");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
