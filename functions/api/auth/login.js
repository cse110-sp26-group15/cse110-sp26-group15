import bcryptjs from "bcryptjs";

/**
 * Returns true when `email` matches the basic local@domain.tld shape.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Returns true when `password` meets the minimum length requirement (8 chars).
 * @param {string} password
 * @returns {boolean}
 */
function validatePassword(password) {
  return password.length >= 8;
}

/**
 * Generates a cryptographically random 64-char hex session token (256 bits).
 * @returns {string}
 */
function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudflare Pages function: POST /api/auth/login
 *
 * Authenticates a user by email + password against the `users` table, issues
 * a session token, and sets it as an httpOnly `sitrep_token` cookie. Returns
 * a generic 401 for invalid credentials or inactive accounts so attackers
 * cannot distinguish "no such user" from "wrong password".
 *
 * Request body: { email: string, password: string }
 * Response 200: { user: { user_id, email, full_name }, token: string }
 *
 * @param {{ env: { DB: object }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password } = body;

  // Validation
  if (!email || typeof email !== "string" || !validateEmail(email.trim())) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (!password || typeof password !== "string" || !validatePassword(password)) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  try {
    // Find user by email
    const user = await env.DB.prepare(
      "SELECT user_id, email, full_name, password_hash, is_active FROM users WHERE email = ?"
    )
      .bind(email.trim().toLowerCase())
      .first();

    if (!user || !user.is_active) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Verify password
    const isValid = await bcryptjs.compare(password, user.password_hash);

    if (!isValid) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Generate session token
    const sessionToken = generateSessionToken();

    // TODO: Store token in sessions table with expiration

    // Return user data (without password_hash)
    const response = Response.json(
      {
        user: { user_id: user.user_id, email: user.email, full_name: user.full_name },
        token: sessionToken,
      },
      { status: 200 }
    );

    // Set httpOnly cookie
    response.headers.set(
      "Set-Cookie",
      `sitrep_token=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
    );

    return response;
  } catch (err) {
    console.error("Login error:", err);
    return Response.json({ error: "Failed to log in. Please try again." }, { status: 500 });
  }
}
