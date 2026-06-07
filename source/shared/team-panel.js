import { apiFetch, apiAddMember } from "./utils.js";

/**
 * Escape the five HTML metacharacters for safe interpolation.
 * @param {unknown} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Up to two uppercase initials from a display name.
 * @param {string} name
 * @returns {string}
 */
function initials(name) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Build the Team panel markup: a member roster, pending invites, and an
 * add-member form. Pure (no DOM access) so it is unit-testable.
 * @param {{ members: object[], pending_invites: object[] }} data
 * @returns {string} HTML string
 */
export function buildTeamPanelHtml({ members = [], pending_invites = [] } = {}) {
  const memberRows = members
    .map(
      (m) => `
      <li class="team-member">
        <div class="avatar team-avatar">${esc(initials(m.full_name))}</div>
        <div class="team-member-info">
          <p class="team-member-name">${esc(m.full_name)}</p>
          <p class="team-member-meta">${esc(m.email ?? "")}${m.role ? " · " + esc(m.role) : ""}</p>
        </div>
      </li>`
    )
    .join("");

  const pendingRows = pending_invites
    .map(
      (i) => `
      <li class="team-member team-member--pending">
        <div class="avatar team-avatar team-avatar--pending">?</div>
        <div class="team-member-info">
          <p class="team-member-name">${esc(i.email)}</p>
          <p class="team-member-meta">Pending</p>
        </div>
      </li>`
    )
    .join("");

  return `
    <div class="team-panel">
      <h2 class="team-panel-title">Team members</h2>
      <ul class="team-list">${memberRows || `<li class="team-empty">No members yet.</li>`}${pendingRows}</ul>
      <form class="team-add" id="team-add-form">
        <input type="email" id="team-add-email" class="team-add-input"
               placeholder="teammate@example.com" autocomplete="off" />
        <button type="submit" class="btn-add-member">Add member</button>
        <p class="team-add-status" id="team-add-status" aria-live="polite"></p>
      </form>
    </div>`;
}

/**
 * Fetch members + pending invites for a project and render the Team panel
 * into `container`, wiring the add-member form to POST and re-render.
 * @param {HTMLElement} container
 * @param {{ projectId: number|string }} opts
 * @returns {Promise<void>}
 */
export async function renderTeamPanel(container, { projectId }) {
  if (!container) return;
  container.classList.remove("placeholder");
  let data = { members: [], pending_invites: [] };
  try {
    data = await apiFetch(`/api/projects/${projectId}/members`);
  } catch (err) {
    container.innerHTML = `<p class="team-empty">Failed to load team: ${esc(err.message)}</p>`;
    return;
  }
  container.innerHTML = buildTeamPanelHtml(data);

  const form = container.querySelector("#team-add-form");
  const input = container.querySelector("#team-add-email");
  const status = container.querySelector("#team-add-status");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    try {
      const res = await apiAddMember(projectId, email);
      status.textContent =
        res.status === "pending"
          ? "Invited — they'll join once they sign up."
          : res.status === "already_member"
            ? "Already a member."
            : "Member added.";
      await renderTeamPanel(container, { projectId });
    } catch (err) {
      status.textContent = err.message || "Could not add member.";
    }
  });
}
