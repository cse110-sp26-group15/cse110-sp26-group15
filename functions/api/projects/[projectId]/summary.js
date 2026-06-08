// ── AI standup summarizer ─────────────────────────────────────────────
// POST /api/projects/:projectId/summary
//
// Pulls the project's recent check-ins (last 24h) plus open blockers and
// asks an LLM to produce a one-paragraph SitRep digest the team can drop
// straight into Slack or a daily email. Returns a plain JSON
// `{ summary, model, generated_at, source_counts }` so the dashboard can
// render it without a streaming UI.
//
// Provider: Anthropic via fetch using `env.ANTHROPIC_API_KEY`. When the
// key is missing (e.g. local dev without secrets), we fall back to a
// deterministic template summary so the UI still works — the response
// `source` field tells the client which path was taken.

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * Render the check-ins + blockers into the bulleted prompt body we hand
 * to the model. Pure so unit tests can pin it without a fetch.
 *
 * @param {object[]} checkins - Rows from `SELECT ... FROM checkins JOIN users`.
 * @param {object[]} blockers - Rows from `SELECT ... FROM blockers JOIN ...`.
 * @returns {string}
 */
export function buildPrompt(checkins, blockers) {
  const checkinLines = (checkins ?? []).map((c) => {
    const done = c.work_done?.trim() || "(no update)";
    const planned = c.work_planned?.trim() || "(no plan)";
    return `- ${c.full_name}: did "${done}" / next "${planned}"`;
  });

  const blockerLines = (blockers ?? []).map((b) => {
    const who = b.reported_by || "Unknown";
    const what = b.description?.trim() || "(no description)";
    const help = b.helper ? ` (needs: ${b.helper})` : "";
    return `- ${who}: ${what}${help}`;
  });

  const sections = [
    "You are writing a daily standup digest for a software team. Be concise — one short paragraph (3–5 sentences). Lead with what's getting done, then what's coming next, then any blockers worth attention. No greetings, no sign-off, no markdown headings.",
    "",
    "CHECK-INS (last 24h):",
    checkinLines.length ? checkinLines.join("\n") : "(none)",
    "",
    "OPEN BLOCKERS:",
    blockerLines.length ? blockerLines.join("\n") : "(none)",
  ];

  return sections.join("\n");
}

/**
 * Deterministic fallback used when no API key is configured. Mirrors the
 * shape the model would produce so the UI doesn't need to special-case
 * either path.
 *
 * @param {object[]} checkins
 * @param {object[]} blockers
 * @returns {string}
 */
export function fallbackSummary(checkins, blockers) {
  const n = checkins?.length ?? 0;
  const b = blockers?.length ?? 0;

  if (n === 0 && b === 0) {
    return "No check-ins or open blockers in the last day. Quiet standup — no action needed.";
  }

  const names = [...new Set((checkins ?? []).map((c) => c.full_name).filter(Boolean))];
  const peopleLabel = names.length
    ? names.slice(0, 3).join(", ") + (names.length > 3 ? `, +${names.length - 3} others` : "")
    : "the team";

  const blockerLabel = b === 0 ? "no open blockers" : `${b} open blocker${b === 1 ? "" : "s"}`;

  return `${n} check-in${n === 1 ? "" : "s"} from ${peopleLabel} in the last 24 hours. ${blockerLabel}. Review the dashboard for full details.`;
}

/**
 * Call Anthropic's messages API. Isolated so the unit suite can stub it
 * with a fake `fetchImpl`.
 *
 * @param {string} apiKey
 * @param {string} prompt
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function callAnthropic(apiKey, prompt, fetchImpl = fetch) {
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Anthropic returned an empty completion.");
  }
  return text.trim();
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let checkins;
  let blockers;
  try {
    [{ results: checkins }, { results: blockers }] = await Promise.all([
      env.DB.prepare(
        `SELECT c.work_done, c.work_planned, c.status_mood, u.full_name
           FROM checkins c
           JOIN users u ON c.user_id = u.user_id
           WHERE c.project_id = ?
             AND c.checkin_date >= datetime('now', '-1 day')
           ORDER BY c.checkin_date DESC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT b.description, b.helper, u.full_name AS reported_by
           FROM blockers b
           JOIN checkins c ON b.checkin_id = c.checkin_id
           JOIN users u ON c.user_id = u.user_id
           WHERE c.project_id = ? AND b.is_resolved = 0
           ORDER BY b.blocker_id DESC`
      )
        .bind(projectId)
        .all(),
    ]);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }

  const prompt = buildPrompt(checkins, blockers);
  const source_counts = {
    checkins: checkins.length,
    blockers: blockers.length,
  };

  // No key → fallback (still useful in local dev / CI).
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({
      summary: fallbackSummary(checkins, blockers),
      model: null,
      source: "fallback",
      source_counts,
      generated_at: new Date().toISOString(),
    });
  }

  try {
    const summary = await callAnthropic(env.ANTHROPIC_API_KEY, prompt, context.fetch ?? fetch);
    return Response.json({
      summary,
      model: MODEL,
      source: "anthropic",
      source_counts,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    // Don't blow up the dashboard if Anthropic is having a bad day — degrade
    // to the deterministic summary and surface the reason in the payload.
    return Response.json({
      summary: fallbackSummary(checkins, blockers),
      model: null,
      source: "fallback",
      source_counts,
      generated_at: new Date().toISOString(),
      degraded_reason: err.message,
    });
  }
}
