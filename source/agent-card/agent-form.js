// ── Agent creation modal ───────────────────────────────────────────────
// Lightweight modal for `POST /api/projects/:projectId/agents`. Mirrors
// the task-form pattern: a single exported `openAgentModal({ members,
// onSubmit })` that builds the DOM, attaches close/keydown handlers, and
// hands the validated form data to the caller. Reuses the `.tf-*`
// styles already injected by task-form.js, so dashboards that already
// load task-form.js get this modal styled for free.

import { apiFetch } from "../shared/utils.js";

// Keep in sync with VALID_AGENT_TYPES in
// functions/api/projects/[projectId]/agents.js — the server rejects any
// other value with a 400, so adding an option here without updating the
// server (or vice versa) silently breaks the form.
const AGENT_TYPES = [
  { value: "standup-summarizer", label: "Standup summarizer" },
  { value: "spec-reviewer", label: "Spec reviewer" },
  { value: "code-review", label: "Code review" },
  { value: "qa-bot", label: "QA bot" },
  { value: "research-assistant", label: "Research assistant" },
  { value: "general", label: "General" },
];

/**
 * POSTs a new agent to the project. Thin wrapper so dashboards don't
 * have to duplicate the endpoint URL.
 *
 * @param {number|string} projectId
 * @param {object} data - { full_name, email, agent_type, owner_user_id, description? }
 * @returns {Promise<object>} API response body ({ agent }).
 */
export async function createAgent(projectId, data) {
  return apiFetch(`/api/projects/${projectId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/**
 * Open the "Add agent" modal.
 *
 * @param {object} opts
 * @param {object[]} opts.members - Project members; agents are filtered
 *   out here so the owner picker only lists humans (matches the server
 *   constraint that an agent can't own another agent).
 * @param {(data: object) => Promise<void>} opts.onSubmit - Receives the
 *   validated payload to POST. Errors thrown inside `onSubmit` keep the
 *   modal open and surface in the inline error row.
 */
export function openAgentModal({ members = [], onSubmit }) {
  if (typeof document === "undefined") return;

  const humans = members.filter((m) => !m.is_agent);

  const backdrop = document.createElement("div");
  backdrop.className = "tf-backdrop";

  const modal = document.createElement("div");
  modal.className = "tf-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  // ── Header ───────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "tf-header";

  const heading = document.createElement("h2");
  heading.className = "tf-title";
  heading.textContent = "Add AI agent";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tf-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";

  header.appendChild(heading);
  header.appendChild(closeBtn);

  // ── Body ─────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "tf-body";

  const nameField = field("Name", "af-name", true, () => {
    const i = document.createElement("input");
    i.type = "text";
    i.id = "af-name";
    i.className = "tf-input";
    i.placeholder = "e.g. SitRep-Bot-v1";
    i.required = true;
    return i;
  });

  const emailField = field("Email (unique id)", "af-email", true, () => {
    const i = document.createElement("input");
    i.type = "email";
    i.id = "af-email";
    i.className = "tf-input";
    i.placeholder = "bot@yourteam.ai";
    i.required = true;
    return i;
  });

  const typeField = field("Agent type", "af-type", true, () => {
    const s = document.createElement("select");
    s.id = "af-type";
    s.className = "tf-input";
    for (const t of AGENT_TYPES) {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = t.label;
      s.appendChild(opt);
    }
    return s;
  });

  const ownerField = field("Owner (human)", "af-owner", true, () => {
    const s = document.createElement("select");
    s.id = "af-owner";
    s.className = "tf-input";
    if (humans.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No humans on this project yet";
      opt.disabled = true;
      opt.selected = true;
      s.appendChild(opt);
      s.disabled = true;
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select an owner…";
      placeholder.disabled = true;
      placeholder.selected = true;
      s.appendChild(placeholder);
      for (const m of humans) {
        const opt = document.createElement("option");
        opt.value = String(m.user_id);
        opt.textContent = m.full_name ?? `User #${m.user_id}`;
        s.appendChild(opt);
      }
    }
    return s;
  });

  const descField = field("Description (optional)", "af-desc", false, () => {
    const ta = document.createElement("textarea");
    ta.id = "af-desc";
    ta.className = "tf-textarea";
    ta.placeholder = "What does this agent do?";
    ta.rows = 3;
    return ta;
  });

  body.appendChild(nameField);
  body.appendChild(emailField);
  body.appendChild(typeField);
  body.appendChild(ownerField);
  body.appendChild(descField);

  // ── Inline error row ─────────────────────────────────
  const errorEl = document.createElement("p");
  errorEl.className = "tf-error";
  errorEl.style.color = "var(--color-error, #c00)";
  errorEl.style.fontSize = "13px";
  errorEl.style.margin = "0 24px";
  errorEl.hidden = true;

  // ── Footer ───────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "tf-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn--secondary";
  cancelBtn.textContent = "Cancel";

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "btn btn--primary";
  submitBtn.textContent = "Add agent";

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(errorEl);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // ── Close + submit wiring ────────────────────────────
  function close() {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);

  submitBtn.addEventListener("click", async () => {
    errorEl.hidden = true;

    const full_name = /** @type {HTMLInputElement} */ (document.getElementById("af-name")).value.trim();
    const email = /** @type {HTMLInputElement} */ (document.getElementById("af-email")).value.trim();
    const agent_type = /** @type {HTMLSelectElement} */ (document.getElementById("af-type")).value;
    const owner_user_id = /** @type {HTMLSelectElement} */ (document.getElementById("af-owner")).value;
    const description = /** @type {HTMLTextAreaElement} */ (document.getElementById("af-desc")).value.trim() || null;

    if (!full_name) return showError("Name is required.");
    if (!email) return showError("Email is required.");
    if (!owner_user_id) return showError("Pick a human owner.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";
    try {
      await onSubmit({
        full_name,
        email,
        agent_type,
        owner_user_id: Number(owner_user_id),
        description,
      });
      close();
    } catch (err) {
      showError(err?.message ?? "Failed to add agent.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Add agent";
    }
  });

  // Small helper — wraps a label + control in the tf-field row.
  function field(labelText, forId, required, makeControl) {
    const wrap = document.createElement("div");
    wrap.className = "tf-field";
    const lbl = document.createElement("label");
    lbl.className = "tf-label";
    lbl.setAttribute("for", forId);
    lbl.innerHTML = required ? `${labelText} <span class="tf-required">*</span>` : labelText;
    wrap.appendChild(lbl);
    wrap.appendChild(makeControl());
    return wrap;
  }

  document.getElementById("af-name")?.focus();
}
