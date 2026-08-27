// Vercel Edge Function: GET /api/fortyguard/usage
//
// Thin proxy to FortyGuard's real "Check API Credits Usage" endpoint — keeps
// FORTYGUARD_API_KEY server-side, never shipped to the browser.
//
// CONFIRMED live against a real key on 2026-08-27 (docs-api.fortyguard.com's
// interactive "Check API Credits Usage" page doesn't document a static
// request/response schema on the page itself — it's a try-it-only widget —
// so this was reverse-engineered from the browser network request the
// widget makes):
//   POST https://api.fortyguard.com/v1/system/fetch-api-key-usage
//   Header: api-key: <key>
//   Body:   { "api_key": "<key>" }   (yes, the key again in the body — the
//           widget posts it there, and the endpoint 422s without it even
//           though the header is also required)
//   Response 200: {
//     subscription_id, plan_details: { plan_type, cycle_type,
//       subscription_start_date, billing_period, active, credits_reset_date },
//     api_key_details: { status, valid, expiry_date, api_access_available },
//     credit_summary: { total_available_credits, cycle_credits_used,
//       cycle_remaining_credits, cycle_usage_percentage, total_credits_used,
//       total_remaining_credits },
//     activity_breakdown: [{ name, credits, count, percentage }, ...],
//     billing_cycle: { start_date, end_date, credits_reset_date }
//   }
// Despite the real method being POST, this route is exposed to the client
// as GET — it's a read-only lookup keyed entirely by the server-side API
// key, no client-supplied body needed.

export const config = { runtime: "edge" };

const FORTYGUARD_BASE_URL = "https://api.fortyguard.com";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.FORTYGUARD_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        configError: true,
        error:
          "FORTYGUARD_API_KEY is not set. Add it to .env.local (see .env.example) — until then usage can't be checked.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FORTYGUARD_BASE_URL}/v1/system/fetch-api-key-usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({ api_key: apiKey }),
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
