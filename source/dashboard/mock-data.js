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
