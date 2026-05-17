import { createBlockerCard, createBlockerRail, mapApiBlocker } from "./blocker-card.js";

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

const BLOCKERS = SAMPLE_API_ROWS.map(mapApiBlocker);

// ── Render ────────────────────────────────────────────
function renderRail() {
  const section = document.getElementById("demo-rail");
  if (!section) return;
  const rail = createBlockerRail(BLOCKERS);
  if (rail) section.appendChild(rail);
}

function renderCards() {
  const grid = document.querySelector("#demo-cards .demo-grid");
  if (!grid) return;
  BLOCKERS.forEach((blocker) => {
    grid.appendChild(createBlockerCard(blocker));
  });
}

renderRail();
renderCards();
