import { createBlockerCard, mapApiBlocker } from "./blocker-card.js";
import { mountBlockerRail } from "./blocker-card-init.js";

// ── Sample blockers (matches /api/blockers?general=true response rows) ──
const SAMPLE_API_ROWS = [
  {
    task: "Add filter by priority to dashboard",
    blocked: true,
    helper: "Sara R.",
    description: "Mobile breakpoints and dark mode tokens are missing from the Figma file.",
  },
  {
    task: "Deploy staging environment",
    blocked: true,
    helper: "Wayne D.",
    description: "Database migration script needs to land before integration testing can begin.",
  },
  {
    task: "Fix login timeout on mobile",
    blocked: true,
    helper: null,
    description: "Security team hasn't provisioned OAuth tokens for prod.",
  },
  {
    task: null,
    blocked: false,
    helper: "Jordan M.",
    description: "Backend API contract finalized — unblocked the auth team.",
  },
];

// ── In-memory store (stands in for the API) ───────────
const STORE = SAMPLE_API_ROWS.map((row, idx) => ({ ...row, blocker_id: idx + 1 }));

async function demoFetchBlockers() {
  return STORE.slice();
}

async function demoResolveBlocker(blocker) {
  // Real impl would PATCH /api/blockers/:id and match on `blocker_id` — the
  // field-equality match below is a demo-only shim because mapApiBlocker
  // doesn't carry the id through yet. Don't copy this pattern into prod code.
  const target = STORE.find(
    (row) =>
      row.task === blocker.task &&
      row.description === blocker.description &&
      row.helper === blocker.helper
  );
  if (target) target.blocked = false;
}

// ── Render the live rail (using the real mount factory) ──
mountBlockerRail({
  container: document.getElementById("demo-rail"),
  fetchBlockers: demoFetchBlockers,
  resolveBlocker: demoResolveBlocker,
  findTask: () => null, // demo has no task list — every footer click shows the missing flash
});

// ── Static card grid (no rail) showing visual variants ──
// No onResolve here — these cards are visual references only.
function renderStaticCards() {
  const grid = document.querySelector("#demo-cards .demo-grid");
  if (!grid) return;
  SAMPLE_API_ROWS.map(mapApiBlocker).forEach((blocker) => {
    grid.appendChild(createBlockerCard(blocker));
  });
}

renderStaticCards();
