export async function onRequestPost() {
  const response = Response.json({ success: true }, { status: 200 });

  // Clear httpOnly cookie
  response.headers.set(
    "Set-Cookie",
    "sitrep_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  );

  return response;
}
