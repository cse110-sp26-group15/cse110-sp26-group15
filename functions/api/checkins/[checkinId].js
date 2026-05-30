/**
 * Cloudflare Pages function: DELETE /api/checkins/:checkinId
 *
 * Hard-deletes a check-in and any blockers attached to it. The schema
 * doesn't run with `PRAGMA foreign_keys=ON`, so cascading the blocker
 * cleanup ourselves keeps the DB from accumulating orphan rows.
 *
 * @param {{ env: { DB: object }, params: { checkinId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { checkinId } = params;

  try {
    const checkin = await env.DB.prepare("SELECT checkin_id FROM checkins WHERE checkin_id = ?")
      .bind(checkinId)
      .first();

    if (!checkin) {
      return Response.json({ error: "Check-in not found" }, { status: 404 });
    }

    await env.DB.prepare("DELETE FROM blockers WHERE checkin_id = ?").bind(checkinId).run();
    await env.DB.prepare("DELETE FROM checkins WHERE checkin_id = ?").bind(checkinId).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
