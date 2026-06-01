-- AI agent extension. Each row is a 1:1 extension of `users` (where
-- `users.role = 'AI-agent'`) carrying agent-specific metadata. We model
-- agents as an extension table rather than a parallel top-level entity so
-- the existing user_id foreign keys — tasks.assigned_to, checkins.user_id,
-- project_members.user_id — keep working for agents with zero churn.
-- A user is an agent iff a row exists here.
CREATE TABLE agents (
    user_id INTEGER PRIMARY KEY,
    agent_type TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    description TEXT,
    last_active_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id)
);

-- Speeds up "agents I'm responsible for" lookups on the dashboard.
CREATE INDEX idx_agents_owner ON agents(owner_user_id);

-- Reviewer + review-status fields for human oversight of agent-assigned
-- tasks. The API requires `reviewer_id` whenever `assigned_to` is an
-- agent and defaults it to the agent's owner. `review_status` stays at
-- 'not-required' for non-agent tasks so existing rows behave unchanged.
ALTER TABLE tasks ADD COLUMN reviewer_id INTEGER REFERENCES users(user_id);
ALTER TABLE tasks ADD COLUMN review_status TEXT
    CHECK(review_status IN ('not-required', 'pending', 'approved', 'needs-revision'))
    DEFAULT 'not-required';
