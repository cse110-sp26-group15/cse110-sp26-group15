// Backend entry-point dispatcher: GET /app
//
// Decides where a visitor belongs based on their session and how many projects
// they're a member of, then 302-redirects there. This is what makes returning
// users skip onboarding (issue requirement 6) — the routing decision lives on
// the server rather than being duplicated across client pages.
//
//   - no valid session        -> /login/
//   - signed in, 0 projects    -> /project-setup/   (onboarding)
//   - signed in, >= 1 project  -> /projects/projects.html  (Projects page)
//
// The session is resolved by the global middleware (functions/_middleware.js)
// into context.data.userId before this runs. index.html, login, and signup all
// send users here after auth so the rule has a single home.

const LOGIN = "/login/";
const ONBOARDING = "/project-setup/";
const PROJECTS = "/projects/projects.html";

export async function onRequestGet(context) {
  const { env, request } = context;
  const userId = context.data?.userId;

  // Build an absolute URL for the redirect target (Response.redirect requires
  // one) relative to the current request.
  const to = (path) => Response.redirect(new URL(path, request.url).toString(), 302);

  // Not signed in (or expired session) → send to login.
  if (!userId) return to(LOGIN);

  // Without a DB we can't count projects; onboarding is the safe default that
  // works for any state.
  if (!env?.DB) return to(ONBOARDING);

  let count = 0;
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM project_members WHERE user_id = ?"
    )
      .bind(userId)
      .first();
    count = Number(row?.n ?? 0);
  } catch (err) {
    console.error("[app dispatcher] project count failed", err);
    return to(ONBOARDING);
  }

  // Returning members go to the Projects page; brand-new users to onboarding.
  return to(count > 0 ? PROJECTS : ONBOARDING);
}
