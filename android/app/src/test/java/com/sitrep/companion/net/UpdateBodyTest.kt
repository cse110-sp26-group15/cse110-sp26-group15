package com.sitrep.companion.net

import com.sitrep.companion.sync.TaskPayload
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the queued edit actually puts on the wire.
 *
 * The case that matters is an unassigned task. The cache stores "nobody is
 * assigned" as the sentinel 0, and sending `assigned_to: 0` earned a 400 from
 * the live server, which the sync engine treats as permanent - so the edit was
 * dropped and never retried. Found by driving the app on an emulator against
 * `wrangler pages dev`, editing the one seeded task with no assignee.
 */
class UpdateBodyTest {

    private fun payload(assignedTo: Long) =
        TaskPayload(
            title = "Triage backlog for sprint 3 - control A",
            description = null,
            status = "todo",
            assignedTo = assignedTo,
        )

    @Test
    fun `an unassigned task sends no assigned_to at all`() {
        val body = Json.parseToJsonElement(updateBody(payload(0L), baseVersion = 1)).jsonObject

        assertFalse(
            "assigned_to: 0 is refused by the server with 400 and the edit is lost",
            body.containsKey("assigned_to"),
        )
        // The rest of the edit still has to be there, or the omission would be
        // hiding a broken body rather than fixing one field.
        assertEquals("Triage backlog for sprint 3 - control A", body["title"]!!.jsonPrimitive.content)
        assertEquals("todo", body["status"]!!.jsonPrimitive.content)
        assertEquals(1, body["version"]!!.jsonPrimitive.content.toInt())
        assertTrue(body.containsKey("description"))
    }

    @Test
    fun `an assigned task still sends its assignee`() {
        val body = Json.parseToJsonElement(updateBody(payload(4L), baseVersion = 7)).jsonObject

        assertEquals(4, body["assigned_to"]!!.jsonPrimitive.content.toInt())
        assertEquals(7, body["version"]!!.jsonPrimitive.content.toInt())
    }
}
