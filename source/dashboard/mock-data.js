// ── Mock Data ─────────────────────────────────────────
// TODO: remove this file when connecting to real API

export let mockTasks = [
  { task_id: 1, title: "Set up repo structure", status: "done", user_id: 1, full_name: "Wayne D." },
  { task_id: 2, title: "Write user personas", status: "done", user_id: 2, full_name: "Alex K." },
  {
    task_id: 3,
    title: "Build check-in form",
    status: "in-progress",
    user_id: 1,
    full_name: "Wayne D.",
  },
  {
    task_id: 4,
    title: "Wire up kanban board",
    status: "in-progress",
    user_id: 2,
    full_name: "Alex K.",
  },
  { task_id: 5, title: "Write unit tests", status: "todo", user_id: null, full_name: null },
  { task_id: 6, title: "Set up CI pipeline", status: "todo", user_id: null, full_name: null },
];

export const mockMembers = [
  { user_id: 1, full_name: "Wayne D." },
  { user_id: 2, full_name: "Alex K." },
  { user_id: 3, full_name: "Jordan L." },
];

export const mockCheckins = [
  {
    checkin_id: 101,
    user: { user_id: 1, full_name: "Wayne D." },
    work_done: "Reviewed the kanban drop-handler refactor and merged it.",
    work_planned: "Start the check-in form scaffolding this afternoon.",
    status_mood: "on-track",
    checkin_date: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    checkin_id: 102,
    user: { user_id: 1, full_name: "Wayne D." },
    work_done: "Wired the task-card component into the kanban board.",
    status_mood: "in-progress",
    checkin_date: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    checkin_id: 103,
    user: { user_id: 1, full_name: "Wayne D." },
    work_done: "Hit auth issues wiring up the dashboard API contract.",
    work_planned: "Pair with Alex tomorrow to unblock.",
    status_mood: "blocked",
    checkin_date: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    checkin_id: 104,
    user: { user_id: 1, full_name: "Wayne D." },
    work_done: "Set up repo structure and wrote the README.",
    status_mood: "on-track",
    checkin_date: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
  },
];