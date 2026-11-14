package com.sitrep.companion.ui

/**
 * The one line under the project name that answers "is my work on the server?".
 *
 * Kept as a pure function (and out of the composables) because getting it wrong
 * has form: the app bar used to derive this from the PENDING count alone, so a
 * board whose only queued work was a parked conflict read "Synced" while an
 * edit sat waiting for a keep-mine / keep-theirs decision. A conflict outranks
 * plain queued work here for the same reason: it is the state that stays
 * forever unless the user acts.
 */
fun syncSubtitle(pending: Int, conflicts: Int): String =
    when {
        conflicts > 0 -> "$conflicts change(s) need a decision"
        pending > 0 -> "$pending change(s) waiting to sync"
        else -> "Synced"
    }
