// xp-pairs.js — XP Pair Programming (API-backed, project-scoped)

import { apiFetch, getCurrentProjectId } from "../shared/utils.js";

const PROJECT_ID = getCurrentProjectId();

// Pair sessions from the most recent load. Cached so the XP dashboard can link
// task pair-partners with these sessions without an extra round trip.
let loadedPairs = [];

// Real project members only. Pairing must reference users who actually belong
// to the project — anything else fails the server's membership check and never
// persists, so we never invent placeholder people here.
function getMembers() {
  return window.getProjectMembers?.() ?? [];
}

// ── Utilities ─────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// ── Rendering ─────────────────────────────────────────

function renderPairCards(pairs) {
  const list = document.getElementById("pair-list");
  if (!list) return;

  if (!Array.isArray(pairs) || pairs.length === 0) {
    list.innerHTML = `<p class="task-empty">No active pairs. Click "+ new pair" to create one.</p>`;
    return;
  }

  list.innerHTML = pairs
    .map(
      (p) => `
      <article class="pair-card" data-pair-id="${esc(String(p.pair_id))}">
        <div class="pair-card-header">
          <span class="pair-card-title">Pair Session</span>
          <button
            class="btn-link pair-delete-btn"
            data-pair-id="${esc(String(p.pair_id))}"
            type="button"
            aria-label="Remove pair"
          >&#x2715;</button>
        </div>
        <div class="pair-card-body">
          <div class="pair-member">
            <div class="avatar pair-avatar">${initials(p.member1.full_name)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${esc(p.member1.full_name)}</p>
              <p class="pair-member-role">driver</p>
            </div>
          </div>
          <span class="pair-arrow" aria-hidden="true">&#x2194;</span>
          <div class="pair-member">
            <div class="avatar pair-avatar">${initials(p.member2.full_name)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${esc(p.member2.full_name)}</p>
              <p class="pair-member-role">navigator</p>
            </div>
          </div>
        </div>
        <div class="pair-card-footer">
          <p class="pair-meta">active</p>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll(".pair-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      deletePair(btn.dataset.pairId);
    });
  });
}

// ── Core operations (API-backed) ──────────────────────

/**
 * Loads the project's pairs from the API and renders them. On failure the rail
 * shows an error rather than silently inventing data, so what's on screen
 * always reflects the server.
 */
export async function loadPairs() {
  try {
    const data = await apiFetch(`/api/projects/${PROJECT_ID}/pairs`);
    loadedPairs = data.pairs ?? [];
    renderPairCards(loadedPairs);
  } catch (err) {
    console.error("[xp-pairs] loadPairs failed", err);
    const list = document.getElementById("pair-list");
    if (list) {
      list.innerHTML = `<p class="task-empty task-error">⚠ Couldn't load pairs.</p>`;
    }
  }
}

/**
 * The pair sessions from the most recent load. Each entry has
 * `member1`/`member2` objects with `user_id` + `full_name`.
 * @returns {Array<{pair_id: number|string, member1: object, member2: object}>}
 */
export function getLoadedPairs() {
  return loadedPairs;
}

/**
 * Create a pair session for two members if they aren't already paired (in
 * either order) — otherwise a no-op. Used by the task pair-partner picker so
 * pairing two people on a task surfaces a matching Pair Programming session.
 * @param {{user_id: number|string, full_name: string}} member1
 * @param {{user_id: number|string, full_name: string}} member2
 * @returns {Promise<void>}
 */
export async function ensurePairSession(member1, member2) {
  const a = Number(member1?.user_id);
  const b = Number(member2?.user_id);
  if (!a || !b || a === b) return;
  const exists = loadedPairs.some((p) => {
    const m1 = Number(p.member1?.user_id);
    const m2 = Number(p.member2?.user_id);
    return (m1 === a && m2 === b) || (m1 === b && m2 === a);
  });
  if (exists) return;
  await addPair(member1, member2);
}

/**
 * Creates a pair via the API and refreshes the rail. Throws on failure (e.g.
 * the members aren't on the project) so the caller can surface the error —
 * we never fake a "saved" pair that wouldn't survive a refresh.
 * @returns {Promise<void>}
 */
async function addPair(member1, member2) {
  await apiFetch(`/api/projects/${PROJECT_ID}/pairs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member1_id: member1.user_id, member2_id: member2.user_id }),
  });
  await loadPairs();
}

/**
 * Deletes a pair via the API and refreshes the rail. Surfaces failures rather
 * than diverging the UI from the server.
 */
async function deletePair(pairId) {
  try {
    await apiFetch(`/api/projects/${PROJECT_ID}/pairs/${pairId}`, { method: "DELETE" });
    await loadPairs();
  } catch (err) {
    console.error("[xp-pairs] deletePair failed", err);
    alert(`Couldn't remove pair: ${err.message}`);
  }
}

// ── Modal ─────────────────────────────────────────────

let backdrop = null;

function buildOptions(members) {
  const blank = `<option value="">— select a member —</option>`;
  const opts = members
    .map((m) => `<option value="${esc(String(m.user_id))}">${esc(m.full_name)}</option>`)
    .join("");
  return blank + opts;
}

function openModal() {
  if (backdrop) return;
  const members = getMembers();
  // Pairing needs two real project members; without them the create would only
  // fail server-side, so say so up front instead of offering an empty picker.
  const enough = members.length >= 2;

  backdrop = document.createElement("div");
  backdrop.className = "pm-backdrop";
  backdrop.innerHTML = `
    <div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div class="pm-header">
        <h2 class="pm-title" id="pm-title">New Pair</h2>
        <button class="pm-close" type="button" aria-label="Close dialog">&#x2715;</button>
      </div>
      <div class="pm-body">
        ${
          enough
            ? `<div class="pm-field">
                 <label class="pm-label" for="pm-member1">Member 1</label>
                 <select class="input input--select" id="pm-member1">${buildOptions(members)}</select>
               </div>
               <div class="pm-field">
                 <label class="pm-label" for="pm-member2">Member 2</label>
                 <select class="input input--select" id="pm-member2">${buildOptions(members)}</select>
               </div>
               <p class="pm-error hidden" id="pm-error" role="alert"></p>`
            : `<p class="pm-empty">You need at least two members on this project to create a pair. Add members to the project first.</p>`
        }
      </div>
      <div class="pm-footer">
        <button class="btn btn--secondary" id="pm-cancel" type="button">${enough ? "Cancel" : "Close"}</button>
        ${enough ? `<button class="btn btn--primary" id="pm-submit" type="button">Create Pair</button>` : ""}
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  backdrop.querySelector(".pm-close").addEventListener("click", closeModal);
  document.getElementById("pm-cancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  if (enough) {
    document.getElementById("pm-submit").addEventListener("click", handleSubmit);
  }
  document.addEventListener("keydown", onEscape);

  (backdrop.querySelector("#pm-member1") ?? backdrop.querySelector(".pm-close")).focus();
}

function closeModal() {
  if (!backdrop) return;
  backdrop.remove();
  backdrop = null;
  document.removeEventListener("keydown", onEscape);
}

function onEscape(e) {
  if (e.key === "Escape") closeModal();
}

async function handleSubmit() {
  const members = getMembers();
  const sel1 = document.getElementById("pm-member1");
  const sel2 = document.getElementById("pm-member2");
  const errorEl = document.getElementById("pm-error");
  const submitBtn = document.getElementById("pm-submit");

  const id1 = Number(sel1.value);
  const id2 = Number(sel2.value);

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  };

  if (!id1 || !id2) {
    showError("Please select both members.");
    return;
  }
  if (id1 === id2) {
    showError("Please select two different members.");
    return;
  }

  const m1 = members.find((m) => Number(m.user_id) === id1);
  const m2 = members.find((m) => Number(m.user_id) === id2);
  if (!m1 || !m2) {
    showError("Could not find the selected members.");
    return;
  }

  // Wait for the create to actually persist before closing — if it fails, keep
  // the modal open and show why, instead of leaving a pair that vanishes on
  // refresh.
  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  try {
    await addPair(m1, m2);
    closeModal();
  } catch (err) {
    showError(err?.message || "Couldn't create pair. Please try again.");
    submitBtn.disabled = false;
  }
}

// ── Entry point ───────────────────────────────────────

/**
 * Wires the "+ new pair" button. Call once during dashboard init.
 * Pair loading is handled separately by the exported `loadPairs()`.
 */
export function initLocalPairs() {
  const btn = document.getElementById("new-pair-btn");
  if (btn) btn.addEventListener("click", openModal);
}
