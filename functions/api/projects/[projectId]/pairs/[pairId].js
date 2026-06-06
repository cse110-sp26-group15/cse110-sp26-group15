/**
 * Cloudflare Pages function: DELETE /api/projects/:projectId/pairs/:pairId
 *
 * Hard-deletes a pair assignment. Verifies the pair belongs to the given
 * project before deletion to prevent cross-project mutations.
 *
 * Response:
 *   200 { success: true }
 *   404 { error: "Pair not found" }
 *   500 { error: string }
 *
 * @param {{ env: { DB?: object }, params: { projectId: string, pairId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { projectId, pairId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  try {
    const pair = await env.DB.prepare(
      `SELECT pair_id FROM xp_pairs WHERE pair_id = ? AND project_id = ?`
    )
      .bind(pairId, projectId)
      .first();

    if (!pair) {
      return Response.json({ error: "Pair not found" }, { status: 404 });
    }

    await env.DB.prepare(`DELETE FROM xp_pairs WHERE pair_id = ?`).bind(pairId).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
