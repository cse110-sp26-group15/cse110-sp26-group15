import { requireProjectMember } from "../../_auth.js";

/**
 * Scoped middleware for every route under /api/projects/:projectId/*.
 *
 * Each of these routes (tasks, members, agents, blockers, checkins,
 * checkins/recent, dashboard, sprints/current, and the project record itself)
 * exposes data for a single project, so they all share one access rule: the
 * caller must be a member of that project. Enforcing it here — once, for the
 * whole subtree — means the individual handlers don't each have to remember to
 * call the guard, and a newly added route under this path is protected by
 * default rather than by convention.
 *
 * The members POST route is special: it is used both by current project
 * members to invite teammates and by pending invited users to accept their
 * invitation. The user may not yet be a member when they call it, so we skip
 * the membership guard for that one case.
 *
 * Runs after the global middleware (functions/_middleware.js), so
 * `context.data.userId` is already resolved by the time this executes.
 * `context.params.projectId` is the :projectId segment this middleware sits on.
 *
 * @param {{ params: { projectId: string }, data?: { userId?: number|null }, env?: { DB?: object }, next: () => Promise<Response> }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (context.request.method === "POST" && url.pathname.endsWith("/members")) {
    return context.next();
  }

  const denied = await requireProjectMember(context, context.params.projectId);
  if (denied) return denied;
  return context.next();
}
