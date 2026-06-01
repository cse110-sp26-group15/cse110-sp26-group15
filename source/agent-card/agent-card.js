// ── AI Agent Card ─────────────────────────────────────
// Renders an agent's at-a-glance dashboard card: name, type, owner,
// current task, status, last activity, blocker count. Mirrors the
// existing task-card / blocker-card pattern so the three components
// share visual language. The card is pure DOM — the caller hands in a
// normalised agent object (matches the `agents[]` shape from
// /api/projects/:id/dashboard).

const REVIEW_STATUS_LABEL = {
  "not-required": "no review",
  pending: "pending review",
  approved: "approved",
  "needs-revision": "needs revision",
};

function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatRelative(iso) {
  if (!iso) return "no activity yet";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "no activity yet";
  const now = Date.now();
  const diffMs = now - then.getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Build the AI agent card DOM node.
 *
 * @param {object} agent
 * @param {number} agent.user_id
 * @param {string} agent.full_name
 * @param {string} agent.agent_type
 * @param {string|null} [agent.description]
 * @param {string|null} [agent.last_active_at]    ISO timestamp.
 * @param {{ user_id:number, full_name:string }} agent.owner
 * @param {{ task_id:number, title:string, status:string, review_status:string }|null} [agent.current_task]
 * @param {number} [agent.open_blocker_count=0]
 * @returns {HTMLElement}
 */
export function createAgentCard(agent) {
  const card = el("article", "agent-card");
  card.dataset.agentId = agent.user_id;

  // ── Header: avatar + name + AI badge + type ────────
  const header = el("header", "agent-card__header");
  const avatar = el("div", "agent-card__avatar", initials(agent.full_name));
  header.appendChild(avatar);

  const headerText = el("div", "agent-card__header-text");
  const titleRow = el("div", "agent-card__title-row");
  titleRow.appendChild(el("h3", "agent-card__name", agent.full_name));
  titleRow.appendChild(el("span", "agent-card__ai-badge", "AI"));
  headerText.appendChild(titleRow);
  headerText.appendChild(el("p", "agent-card__type", agent.agent_type));
  header.appendChild(headerText);

  card.appendChild(header);

  // ── Owner ───────────────────────────────────────────
  const owner = el("div", "agent-card__owner");
  owner.appendChild(el("span", "agent-card__owner-label", "Managed by"));
  owner.appendChild(el("span", "agent-card__owner-name", agent.owner?.full_name ?? "—"));
  card.appendChild(owner);

  // ── Description (optional) ──────────────────────────
  if (agent.description) {
    card.appendChild(el("p", "agent-card__description", agent.description));
  }

  // ── Current task ────────────────────────────────────
  const taskRow = el("div", "agent-card__task");
  if (agent.current_task) {
    taskRow.appendChild(el("span", "agent-card__task-label", "Current task"));
    taskRow.appendChild(el("p", "agent-card__task-title", agent.current_task.title));

    const pills = el("div", "agent-card__task-pills");
    const status = agent.current_task.status ?? "todo";
    pills.appendChild(
      el("span", `agent-card__status agent-card__status--${status}`, status.replace("-", " "))
    );
    const review = agent.current_task.review_status ?? "not-required";
    pills.appendChild(
      el(
        "span",
        `agent-card__review agent-card__review--${review}`,
        REVIEW_STATUS_LABEL[review] ?? review
      )
    );
    taskRow.appendChild(pills);
  } else {
    taskRow.classList.add("agent-card__task--empty");
    taskRow.appendChild(el("span", "agent-card__task-label", "Current task"));
    taskRow.appendChild(el("p", "agent-card__task-title agent-card__task-title--empty", "Idle"));
  }
  card.appendChild(taskRow);

  // ── Footer: last activity + blocker badge ───────────
  const footer = el("footer", "agent-card__footer");
  footer.appendChild(
    el("span", "agent-card__last-active", `Last active: ${formatRelative(agent.last_active_at)}`)
  );
  const blockerCount = agent.open_blocker_count ?? 0;
  if (blockerCount > 0) {
    footer.appendChild(
      el(
        "span",
        "agent-card__blocker-badge",
        `⚠ ${blockerCount} blocker${blockerCount > 1 ? "s" : ""}`
      )
    );
  }
  card.appendChild(footer);

  return card;
}

/**
 * Render an array of agents into the given container, replacing its
 * content. Handles the empty state ("No AI agents yet") so callers don't
 * have to.
 *
 * @param {HTMLElement} container
 * @param {object[]} agents
 */
export function renderAgents(container, agents) {
  if (!container) return;
  container.innerHTML = "";
  if (!agents || agents.length === 0) {
    const empty = el(
      "p",
      "agent-card__empty",
      "No AI agents on this project yet. Add one to track agent contributions alongside your team."
    );
    container.appendChild(empty);
    return;
  }
  for (const agent of agents) {
    container.appendChild(createAgentCard(agent));
  }
}
