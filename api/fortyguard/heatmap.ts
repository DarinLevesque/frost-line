// Vercel Edge Function: POST /api/fortyguard/heatmap
//
// Thin proxy to FortyGuard's real Create Heatmap endpoint — keeps
// FORTYGUARD_API_KEY server-side, never shipped to the browser.
//
// Confirmed against docs-api.fortyguard.com on 2026-08-27:
//   POST https://api.fortyguard.com/v1/heatmap
//   Header: api-key: <key>          (NOT "Authorization: Bearer ...")
//   Body:   { polygon_aoi, date_time, granularity, analytic_type?, threshold?, direction? }
//   Success response: { error, status_code, message, data: { activity_id } }
// The task is async — this endpoint only submits it. Poll
// /api/fortyguard/status?activity_id=... (see status.ts) for the result.
//
// This route does no schema validation of its own beyond "is it JSON" —
// src/lib/fortyguard.ts on the client builds a request that already matches
// FortyGuard's documented shape, so this stays a dumb, low-risk pass-through.

export const config = { runtime: "edge" };

const FORTYGUARD_BASE_URL = "https://api.fortyguard.com";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.FORTYGUARD_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        configError: true,
        error:
          "FORTYGUARD_API_KEY is not set. Add it to .env.local (see .env.example) — until then the app falls back to simulated data.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FORTYGUARD_BASE_URL}/v1/heatmap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Could not reach FortyGuard: ${(err as Error).message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
