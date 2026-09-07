package com.sitrep.companion.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoginCookieTest {
    @Test
    fun `the native client reads the session from the httpOnly cookie`() {
        val headers =
            listOf(
                "theme=dark; Path=/",
                "sitrep_token=native-session; Path=/; HttpOnly; Secure; SameSite=Strict",
            )

        assertEquals("native-session", sessionTokenFromSetCookie(headers))
    }

    @Test
    fun `an absent or empty session cookie is rejected`() {
        assertNull(sessionTokenFromSetCookie(emptyList()))
        assertNull(sessionTokenFromSetCookie(listOf("theme=dark; Path=/")))
        assertNull(sessionTokenFromSetCookie(listOf("sitrep_token=; Path=/; HttpOnly")))
    }
}
