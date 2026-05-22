import bcryptjs from "bcryptjs";

const SALT_ROUNDS = 10;

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
 * Cloudflare Pages function: POST /api/auth/signup
 *
 * Creates a new user with a bcrypt-hashed password, issues a session token,
 * and sets it as an httpOnly `sitrep_token` cookie. Rejects duplicate emails
 * with 409. The email is normalized (trimmed + lowercased) before storage.
 *
 * Request body: { email: string, password: string }
 * Response 201: { user: { user_id, email, full_name }, token: string }
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
    return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!password || typeof password !== "string" || !validatePassword(password)) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    // Check if email already exists
    const existing = await env.DB.prepare("SELECT user_id FROM users WHERE email = ?")
      .bind(email.trim().toLowerCase())
      .first();

    if (existing) {
      return Response.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(password, SALT_ROUNDS);

    // Insert user
    const result = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES (?, ?, ?, 1)`
    )
      .bind(email.trim().toLowerCase(), passwordHash, "")
      .run();

    const userId = result.meta.last_row_id;

    // Generate session token
    const sessionToken = generateSessionToken();

    // In a real app, you'd store this token in a sessions table
    // For now, we'll include it in the cookie
    // TODO: Create sessions table to track tokens

    // Fetch the created user
    const user = await env.DB.prepare(
      "SELECT user_id, email, full_name FROM users WHERE user_id = ?"
    )
      .bind(userId)
      .first();

    // Set httpOnly cookie
    const response = Response.json({ user, token: sessionToken }, { status: 201 });

    response.headers.set(
      "Set-Cookie",
      `sitrep_token=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
    );

    return response;
  } catch (err) {
    console.error("Signup error:", err);
    return Response.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }
}
