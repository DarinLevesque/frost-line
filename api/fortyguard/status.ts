// Vercel Edge Function: GET /api/fortyguard/status?activity_id=...
//
// Thin proxy to FortyGuard's real Check Status endpoint — every submission
// endpoint (Create Heatmap included) returns an activity_id immediately and
// the task runs async, so the client polls this route until status flips to
// "Completed" or "Failed".
//
// Confirmed against docs-api.fortyguard.com on 2026-08-27:
//   GET https://api.fortyguard.com/v1/status/{activity_id}
//   Header: api-key: <key>
//   Response: { data: { activity_id, status, result? } }
//   result is only present once status === "Completed".

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
        error: "FORTYGUARD_API_KEY is not set. Add it to .env.local (see .env.example).",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const activityId = new URL(req.url).searchParams.get("activity_id");
  if (!activityId) {
    return new Response("Missing activity_id query param", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${FORTYGUARD_BASE_URL}/v1/status/${encodeURIComponent(activityId)}`,
      { headers: { "api-key": apiKey } }
    );
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
