package com.sitrep.companion.net

import com.sitrep.companion.sync.ApiResult
import com.sitrep.companion.sync.RemoteTask
import com.sitrep.companion.sync.SitRepApi
import com.sitrep.companion.sync.TaskPayload
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * The SitRep API over OkHttp.
 *
 * SitRep authenticates with an httpOnly `sitrep_token` cookie, and its login
 * handler also returns the same token in the JSON body. A native client is not
 * a browser, so it reads the token from the body, keeps it in the Keystore-backed
 * [SessionStore], and sets the cookie header itself.
 *
 * Every HTTP status the sync engine cares about is mapped to an [ApiResult]
 * here, so the engine never sees a status code and can be tested without a
 * server.
 */
class HttpSitRepApi(
    private val baseUrl: String,
    private val session: SessionStore,
    private val client: OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build(),
) : SitRepApi {

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    class LoginResult(val userId: Long, val token: String, val fullName: String?)

    suspend fun login(email: String, password: String): Result<LoginResult> =
        withContext(Dispatchers.IO) {
            val body =
                buildJsonObject {
                        put("email", JsonPrimitive(email))
                        put("password", JsonPrimitive(password))
                    }
                    .toString()
            runCatching {
                client
                    .newCall(
                        Request.Builder()
                            .url("$baseUrl/api/auth/login")
                            .post(body.toRequestBody(jsonMedia))
                            .build()
                    )
                    .execute()
                    .use { response ->
                        val text = response.body?.string().orEmpty()
                        if (!response.isSuccessful) error(errorMessage(text, response.code))
                        val obj = json.parseToJsonElement(text).jsonObject
                        val user = obj["user"]!!.jsonObject
                        LoginResult(
                            userId = user["user_id"]!!.jsonPrimitive.content.toLong(),
                            token = obj["token"]!!.jsonPrimitive.content,
                            fullName = user["full_name"]?.stringOrNull(),
                        )
                    }
            }
        }

    /** The caller's projects, as (id, name). Used to pick which board to mirror. */
    suspend fun listProjects(): Result<List<Pair<Long, String>>> =
        withContext(Dispatchers.IO) {
            runCatching {
                client.newCall(authed("$baseUrl/api/projects").build()).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (!response.isSuccessful) error(errorMessage(text, response.code))
                    json.parseToJsonElement(text).jsonObject["projects"]!!.jsonArrayOrEmpty().map {
                        val o = it.jsonObject
                        o["project_id"]!!.jsonPrimitive.content.toLong() to
                            (o["name"]?.stringOrNull() ?: "Project")
                    }
                }
            }
        }

    override suspend fun createTask(
        projectId: Long,
        payload: TaskPayload,
        clientToken: String,
    ): ApiResult =
        withContext(Dispatchers.IO) {
            val body =
                buildJsonObject {
                        put("title", JsonPrimitive(payload.title))
                        put(
                            "description",
                            payload.description?.let { JsonPrimitive(it) } ?: JsonNull,
                        )
                        put("status", JsonPrimitive(payload.status))
                        put("assigned_to", JsonPrimitive(payload.assignedTo))
                        // The idempotency key. Re-sent unchanged on every retry.
                        put("client_token", JsonPrimitive(clientToken))
                    }
                    .toString()
            call(
                authed("$baseUrl/api/projects/$projectId/tasks")
                    .post(body.toRequestBody(jsonMedia))
                    .build()
            )
        }

    override suspend fun updateTask(
        taskId: Long,
        payload: TaskPayload,
        baseVersion: Int,
    ): ApiResult =
        withContext(Dispatchers.IO) {
            val body =
                buildJsonObject {
                        put("title", JsonPrimitive(payload.title))
                        put(
                            "description",
                            payload.description?.let { JsonPrimitive(it) } ?: JsonNull,
                        )
                        put("status", JsonPrimitive(payload.status))
                        put("assigned_to", JsonPrimitive(payload.assignedTo))
                        // Compare-and-swap: the server refuses the write unless
                        // the row is still on this version.
                        put("version", JsonPrimitive(baseVersion))
                    }
                    .toString()
            call(
                authed("$baseUrl/api/tasks/$taskId")
                    .patch(body.toRequestBody(jsonMedia))
                    .build()
            )
        }

    override suspend fun listTasks(projectId: Long): Result<List<RemoteTask>> =
        withContext(Dispatchers.IO) {
            runCatching {
                client
                    .newCall(authed("$baseUrl/api/projects/$projectId/tasks").build())
                    .execute()
                    .use { response ->
                        val text = response.body?.string().orEmpty()
                        if (!response.isSuccessful) error(errorMessage(text, response.code))
                        json
                            .parseToJsonElement(text)
                            .jsonObject["tasks"]!!
                            .jsonArrayOrEmpty()
                            .map { it.jsonObject.toRemoteTask() }
                    }
            }
        }

    private fun authed(url: String): Request.Builder {
        val builder = Request.Builder().url(url)
        session.token?.let { builder.header("Cookie", "sitrep_token=$it") }
        return builder
    }

    private fun call(request: Request): ApiResult =
        try {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                when (response.code) {
                    200,
                    201 -> {
                        val obj = json.parseToJsonElement(text).jsonObject
                        ApiResult.Ok(
                            task = obj["task"]!!.jsonObject.toRemoteTask(),
                            replay =
                                obj["idempotent_replay"]?.jsonPrimitive?.content == "true",
                        )
                    }
                    401 -> ApiResult.Unauthorized
                    403 -> ApiResult.Forbidden(errorMessage(text, 403))
                    404 -> ApiResult.NotFound
                    409 -> {
                        val obj = json.parseToJsonElement(text).jsonObject
                        ApiResult.Conflict(obj["task"]!!.jsonObject.toRemoteTask())
                    }
                    in 400..499 -> ApiResult.Rejected(response.code, errorMessage(text, response.code))
                    // A 5xx is the server's problem, not the request's, so it is
                    // retryable in exactly the way a dead network is.
                    else -> ApiResult.Unreachable("HTTP ${response.code}")
                }
            }
        } catch (e: IOException) {
            ApiResult.Unreachable(e.message ?: "network unavailable")
        }

    private fun errorMessage(text: String, code: Int): String =
        runCatching { json.parseToJsonElement(text).jsonObject["error"]!!.jsonPrimitive.content }
            .getOrElse { "HTTP $code" }
}

private fun JsonElement.stringOrNull(): String? =
    if (this is JsonNull) null else runCatching { jsonPrimitive.content }.getOrNull()

private fun JsonElement.jsonArrayOrEmpty(): List<JsonElement> =
    runCatching { jsonArray.toList() }.getOrElse { emptyList() }

internal fun JsonObject.toRemoteTask(): RemoteTask =
    RemoteTask(
        taskId = this["task_id"]!!.jsonPrimitive.content.toLong(),
        title = this["title"]?.stringOrNull().orEmpty(),
        description = this["description"]?.stringOrNull(),
        status = this["status"]?.stringOrNull() ?: "todo",
        version = this["version"]?.stringOrNull()?.toIntOrNull() ?: 1,
        assignedTo = this["user_id"]?.stringOrNull()?.toLongOrNull(),
        assigneeName = this["full_name"]?.stringOrNull(),
    )
