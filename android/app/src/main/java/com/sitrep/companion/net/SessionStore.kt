package com.sitrep.companion.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Where the session token lives.
 *
 * The token is a bearer credential for the whole account: anything holding it
 * can act as the user until it expires seven days later. It is therefore kept
 * in EncryptedSharedPreferences, whose key material lives in the Android
 * Keystore and never leaves it, rather than in a plain SharedPreferences XML
 * file that anything with filesystem access could read.
 *
 * [clear] is the logout path. It drops the credential; the caller is
 * responsible for destroying the cached task rows in the same breath, because
 * content cached while signed in must not be readable after signing out.
 *
 * The credential writes use `commit()`, not `apply()`. `apply()` returns as soon
 * as the in-memory map is updated and flushes to disk on a background thread, so
 * with it a logout that has "finished" can still leave a live session token in
 * `shared_prefs/sitrep-session.xml` - measured on an emulator, and lost for good
 * if the platform kills the process inside that window. Every caller runs these
 * two setters on Dispatchers.IO, so the synchronous write costs nothing on the
 * main thread. The non-credential fields keep apply(); losing a cached project id
 * to a crash is not a security event.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences =
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit()
                .apply { if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value) }
                .commit()
        }

    var userId: Long
        get() = prefs.getLong(KEY_USER_ID, 0L)
        set(value) = prefs.edit().putLong(KEY_USER_ID, value).apply()

    var email: String?
        get() = prefs.getString(KEY_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_EMAIL, value).apply()

    var projectId: Long
        get() = prefs.getLong(KEY_PROJECT_ID, 0L)
        set(value) = prefs.edit().putLong(KEY_PROJECT_ID, value).apply()

    val isSignedIn: Boolean
        get() = token != null

    /** Logout. Synchronous: the credential is off disk before this returns. */
    fun clear() {
        prefs.edit().clear().commit()
    }

    private companion object {
        const val FILE_NAME = "sitrep-session"
        const val KEY_TOKEN = "token"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMAIL = "email"
        const val KEY_PROJECT_ID = "project_id"
    }
}
