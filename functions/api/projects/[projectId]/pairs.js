/**
 * Cloudflare Pages function: GET  /api/projects/:projectId/pairs
 *                            POST /api/projects/:projectId/pairs
 *
 * GET  – returns all pair assignments for the project, newest first by pair_id.
 * POST – creates a new pair; both member IDs must be distinct and must belong
 *        to the project via project_members.
 *
 * Response shapes:
 *   GET  { pairs: [{ pair_id, member1: { user_id, full_name },
 *                    member2: { user_id, full_name }, created_at }] }
 *   POST { pair:  { pair_id, member1: { user_id, full_name },
 *                   member2: { user_id, full_name }, created_at } }
 */

// Shared SELECT that joins users twice to return full names for both members.
const PAIR_COLS = `
  p.pair_id, p.created_at,
  u1.user_id AS m1_id, u1.full_name AS m1_name,
  u2.user_id AS m2_id, u2.full_name AS m2_name`;

const PAIR_JOINS = `
  FROM xp_pairs p
  JOIN users u1 ON p.member1_id = u1.user_id
  JOIN users u2 ON p.member2_id = u2.user_id`;

function mapPair(row) {
  return {
    pair_id: row.pair_id,
    member1: { user_id: row.m1_id, full_name: row.m1_name },
    member2: { user_id: row.m2_id, full_name: row.m2_name },
    created_at: row.created_at,
  };
}

/**
 * GET /api/projects/:projectId/pairs
 * @param {{ env: { DB?: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { env, params } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT ${PAIR_COLS} ${PAIR_JOINS} WHERE p.project_id = ? ORDER BY p.pair_id ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ pairs: results.map(mapPair) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/projects/:projectId/pairs
 * Body: { member1_id: number, member2_id: number }
 * @param {{ env: { DB?: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { member1_id, member2_id } = body;

  if (
    member1_id === undefined ||
    member1_id === null ||
    member2_id === undefined ||
    member2_id === null
  ) {
    return Response.json({ error: "member1_id and member2_id are required" }, { status: 400 });
  }

  const id1 = Number(member1_id);
  const id2 = Number(member2_id);

  if (!Number.isInteger(id1) || id1 <= 0 || !Number.isInteger(id2) || id2 <= 0) {
    return Response.json(
      { error: "member1_id and member2_id must be positive integers" },
      { status: 400 }
    );
  }
  if (id1 === id2) {
    return Response.json({ error: "member1_id and member2_id must be different" }, { status: 400 });
  }

  try {
    // Both users must be members of the project.
    const { results: found } = await env.DB.prepare(
      `SELECT user_id FROM project_members WHERE project_id = ? AND user_id IN (?, ?)`
    )
      .bind(projectId, id1, id2)
      .all();

    if (found.length < 2) {
      return Response.json({ error: "Both members must belong to this project" }, { status: 400 });
    }

    const insert = await env.DB.prepare(
      `INSERT INTO xp_pairs (project_id, member1_id, member2_id) VALUES (?, ?, ?)`
    )
      .bind(projectId, id1, id2)
      .run();

    const pair = await env.DB.prepare(
      `SELECT ${PAIR_COLS} ${PAIR_JOINS} WHERE p.project_id = ? AND p.pair_id = ?`
    )
      .bind(projectId, insert.meta.last_row_id)
      .first();

    return Response.json({ pair: mapPair(pair) }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
