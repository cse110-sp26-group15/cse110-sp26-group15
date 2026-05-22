-- Add workflow + creator tracking to projects
ALTER TABLE projects ADD COLUMN workflow TEXT CHECK(workflow IN ('scrum', 'kanban', 'xp')) DEFAULT 'scrum';
ALTER TABLE projects ADD COLUMN created_by INTEGER REFERENCES users(user_id);