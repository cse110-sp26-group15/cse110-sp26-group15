import { createBlockerRail, mapApiBlocker } from "./blocker-card.js";

// ── Fetch ─────────────────────────────────────────────
async function fetchGeneralBlockers() {
  try {
    const res = await fetch("/api/blockers?general=true");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.blockers ?? []).map(mapApiBlocker);
  } catch {
    return [];
  }
}

// ── Mount ─────────────────────────────────────────────
async function mountBlockerRail() {
  const dashboard = document.getElementById("dashboard-view");
  const taskHeader = dashboard?.querySelector(".section-header");
  if (!dashboard || !taskHeader) return;

  const blockers = await fetchGeneralBlockers();
  const rail = createBlockerRail(blockers);
  if (!rail) return;

  dashboard.insertBefore(rail, taskHeader);
}

mountBlockerRail();
