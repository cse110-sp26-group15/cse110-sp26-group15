// xp-pairs.js — XP Pair Programming localStorage support

const STORAGE_KEY = "sitrep_pairs";

// Used when the backend has no members yet (frontend-only / pre-API state).
const FALLBACK_MEMBERS = [
  { user_id: 9001, full_name: "Yizhen" },
  { user_id: 9002, full_name: "Unnati" },
  { user_id: 9003, full_name: "Thomas" },
  { user_id: 9004, full_name: "Laksh" },
  { user_id: 9005, full_name: "Dylan" },
  { user_id: 9006, full_name: "Michael" },
];

function getMembers() {
  const api = window.getProjectMembers?.() ?? [];
  return api.length >= 2 ? api : FALLBACK_MEMBERS;
}

function loadPairs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function savePairs(pairs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairs));
}

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

function renderLocalPairs() {
  const list = document.getElementById("pair-list");
  if (!list) return;

  const pairs = loadPairs();

  if (pairs.length === 0) {
    list.innerHTML = `<p class="task-empty">No active pairs. Click "+ new pair" to create one.</p>`;
    return;
  }

  list.innerHTML = pairs
    .map(
      (p) => `
      <article class="pair-card" data-pair-id="${esc(p.pair_id)}">
        <div class="pair-card-header">
          <span class="pair-card-title">Pair Session</span>
          <button
            class="btn-link pair-delete-btn"
            data-pair-id="${esc(p.pair_id)}"
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

function deletePair(pairId) {
  savePairs(loadPairs().filter((p) => p.pair_id !== pairId));
  renderLocalPairs();
}

function addPair(member1, member2) {
  const pair = {
    pair_id: `local-${Date.now()}`,
    member1: { user_id: member1.user_id, full_name: member1.full_name },
    member2: { user_id: member2.user_id, full_name: member2.full_name },
  };
  const pairs = loadPairs();
  pairs.push(pair);
  savePairs(pairs);
  renderLocalPairs();
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

  backdrop = document.createElement("div");
  backdrop.className = "pm-backdrop";
  backdrop.innerHTML = `
    <div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div class="pm-header">
        <h2 class="pm-title" id="pm-title">New Pair</h2>
        <button class="pm-close" type="button" aria-label="Close dialog">&#x2715;</button>
      </div>
      <div class="pm-body">
        <div class="pm-field">
          <label class="pm-label" for="pm-member1">Member 1</label>
          <select class="input input--select" id="pm-member1">${buildOptions(members)}</select>
        </div>
        <div class="pm-field">
          <label class="pm-label" for="pm-member2">Member 2</label>
          <select class="input input--select" id="pm-member2">${buildOptions(members)}</select>
        </div>
        <p class="pm-error hidden" id="pm-error" role="alert"></p>
      </div>
      <div class="pm-footer">
        <button class="btn btn--secondary" id="pm-cancel" type="button">Cancel</button>
        <button class="btn btn--primary" id="pm-submit" type="button">Create Pair</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  backdrop.querySelector(".pm-close").addEventListener("click", closeModal);
  document.getElementById("pm-cancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.getElementById("pm-submit")?.addEventListener("click", handleSubmit);
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

function handleSubmit() {
  const members = getMembers();
  const sel1 = document.getElementById("pm-member1");
  const sel2 = document.getElementById("pm-member2");
  const errorEl = document.getElementById("pm-error");

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

  addPair(m1, m2);
  closeModal();
}

// ── Entry point ───────────────────────────────────────

export function initLocalPairs() {
  renderLocalPairs();

  const btn = document.getElementById("new-pair-btn");
  if (btn) btn.addEventListener("click", openModal);
}
