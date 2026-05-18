import { createTaskCard } from "./task-card.js";

// ── Sample members + tasks ────────────────────────────
const SAMPLE_MEMBERS = [
  { user_id: 1, full_name: "Alex K." },
  { user_id: 2, full_name: "Jordan M." },
  { user_id: 3, full_name: "Sam R." },
  { user_id: 4, full_name: "Riley T." },
];

const SAMPLE_TASKS = [
  {
    task_id: 1,
    title: "Fix login timeout on mobile devices",
    description:
      "Users on iOS are getting logged out after 30 seconds of inactivity. Need to investigate session refresh.",
    assigned_to: 1,
    full_name: "Alex K.",
    status: "in-progress",
    priority: "urgent",
    due_date: "2025-05-18",
    tags: ["bug", "auth"],
    is_blocked: true,
    blocker_reason: "Waiting on API integration",
    story_points: 8,
    sprint: "Sprint 3",
    story_type: "bug",
    estimate_hours: 8,
    pair_assignee: "Jordan M.",
  },
  {
    task_id: 2,
    title: "Add filter by priority to dashboard",
    description:
      "Allow users to filter the task list by priority level so they can focus on what matters most this week.",
    assigned_to: 2,
    full_name: "Jordan M.",
    status: "in-progress",
    priority: "high",
    due_date: "2025-05-20",
    tags: ["frontend", "dashboard"],
    is_blocked: false,
    story_points: 5,
    sprint: "Sprint 3",
    story_type: "story",
    estimate_hours: 4,
    pair_assignee: "Sam R.",
  },
  {
    task_id: 3,
    title: "Update readme with setup instructions",
    description:
      "Add Wrangler CLI setup steps and environment variable configuration so new contributors can get started quickly.",
    assigned_to: 3,
    full_name: "Sam R.",
    status: "done",
    priority: "low",
    due_date: "2025-05-25",
    tags: ["docs"],
    is_blocked: false,
    story_points: 3,
    sprint: "Sprint 3",
    story_type: "task",
    estimate_hours: 2,
    pair_assignee: "Riley T.",
  },
];

// Demo handler — in a real dashboard this would PATCH /api/tasks/:taskId.
function handleChange(taskId, fields) {
  console.log(`Task ${taskId} changed:`, fields);
}

// ── Render ────────────────────────────────────────────
function renderInto(sectionId, projectType) {
  const grid = document.querySelector(`#${sectionId} .demo-grid`);
  if (!grid) return;
  SAMPLE_TASKS.forEach((task) => {
    grid.appendChild(
      createTaskCard(task, projectType, {
        members: SAMPLE_MEMBERS,
        onChange: handleChange,
      })
    );
  });
}

renderInto("demo-kanban", "kanban");
renderInto("demo-scrum", "scrum");
renderInto("demo-xp", "xp");
