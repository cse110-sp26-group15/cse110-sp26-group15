package com.sitrep.companion

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sitrep.companion.net.SessionStore
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Credential storage. This one cannot run on the JVM: EncryptedSharedPreferences
 * derives its key from the Android Keystore, which only exists on a device or
 * emulator, so it is an instrumented test by necessity rather than by choice.
 */
@RunWith(AndroidJUnit4::class)
class SessionStoreInstrumentedTest {

    private lateinit var context: Context
    private lateinit var store: SessionStore

    private val token = "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809"

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.filesDir.parentFile, "shared_prefs/sitrep-session.xml").delete()
        store = SessionStore(context)
        store.clear()
    }

    @Test
    fun theTokenRoundTripsThroughANewInstance() {
        store.token = token
        store.userId = 42L
        store.email = "alice@example.com"
        store.projectId = 7L

        val reopened = SessionStore(context)
        assertEquals(token, reopened.token)
        assertEquals(42L, reopened.userId)
        assertEquals(7L, reopened.projectId)
        assertTrue(reopened.isSignedIn)
    }

    @Test
    fun theTokenIsNotSittingInPlaintextOnDisk() {
        store.token = token

        // SharedPreferences writes asynchronously, so the file is not guaranteed
        // to be on disk the instant the setter returns. Poll rather than assume:
        // this assertion is about the *contents* when they land, not the timing.
        val bytes = awaitPrefsOnDisk()

        assertFalse("the session token must not be readable on disk", bytes.contains(token))
        // The key name is encrypted too, so even the shape of what is stored is hidden.
        assertFalse(bytes.contains("\"token\""))
    }

    /**
     * Logout has to be durable at the moment it returns.
     *
     * [com.sitrep.companion.ui.AppViewModel.logout] deletes the cached rows through
     * Room (which commits before the suspend function resumes) and then drops the
     * credential. If the credential drop is merely queued, there is a window in
     * which the device holds a live session token for an account the user has
     * already signed out of - and a process kill inside that window, which the
     * platform can do at any time, leaves the token on disk permanently.
     */
    @Test
    fun clearRemovesTheCredentialFromDiskBeforeItReturns() {
        store.token = token
        store.email = "alice@example.com"
        val written = awaitPrefsOnDisk()
        assertTrue("precondition: the credential is on disk", entryNames(written).isNotEmpty())

        store.clear()

        // Read the raw file immediately, with no poll and no delay: the question
        // is what an attacker (or a crash) would find the instant clear() returns.
        val after = prefsFile.readText()
        assertEquals(
            "clear() must reach disk before it returns; found ${entryNames(after)}",
            emptyList<String>(),
            entryNames(after),
        )
    }

    private val prefsFile: File
        get() = File(context.filesDir.parentFile, "shared_prefs/sitrep-session.xml")

    /** Wait for the asynchronous SharedPreferences write to land, then return it. */
    private fun awaitPrefsOnDisk(timeoutMs: Long = 5_000): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (prefsFile.exists() && entryNames(prefsFile.readText()).isNotEmpty()) {
                return prefsFile.readText()
            }
            Thread.sleep(25)
        }
        throw AssertionError("the preferences file never reached disk within ${timeoutMs}ms")
    }

    /**
     * The encrypted entries in the file, excluding the Tink keyset that
     * EncryptedSharedPreferences deliberately keeps across a clear().
     */
    private fun entryNames(xml: String): List<String> =
        Regex("""<string name="([^"]+)"""")
            .findAll(xml)
            .map { it.groupValues[1] }
            .filterNot { it.contains("keyset") }
            .toList()

    @Test
    fun clearRemovesTheCredential() {
        store.token = token
        store.email = "alice@example.com"

        store.clear()

        assertNull(SessionStore(context).token)
        assertFalse(SessionStore(context).isSignedIn)
    }
}
