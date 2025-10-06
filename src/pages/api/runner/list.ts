// src/pages/api/runner/list.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Ok = { ok: true; runners: unknown[] };
type Err = { ok: false; error: string };
type Resp = Ok | Err;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // TODO: replace with real data source
  return res.status(200).json({ ok: true, runners: [] });
}
