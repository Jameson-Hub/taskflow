-- Each account belongs to one workspace. Workspace 1 is the shared demo that resets nightly.
CREATE TABLE workspaces (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO workspaces (id, name) VALUES (1, 'Demo workspace');

-- Deleting a workspace cascades to everything in it. SQLite only lets ALTER TABLE add
-- a REFERENCES column with a NULL default, so existing rows are backfilled below.
ALTER TABLE users ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE tasks ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE activity ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;

UPDATE users SET workspace_id = 1;
UPDATE tasks SET workspace_id = 1;
UPDATE activity SET workspace_id = 1;

-- The previous release keeps serving for a few seconds after this runs and doesn't set
-- workspace_id; these put its rows in the demo instead of leaving them in no workspace.
CREATE TRIGGER users_default_workspace AFTER INSERT ON users WHEN NEW.workspace_id IS NULL
BEGIN UPDATE users SET workspace_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER tasks_default_workspace AFTER INSERT ON tasks WHEN NEW.workspace_id IS NULL
BEGIN UPDATE tasks SET workspace_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER activity_default_workspace AFTER INSERT ON activity WHEN NEW.workspace_id IS NULL
BEGIN UPDATE activity SET workspace_id = 1 WHERE id = NEW.id; END;

DROP INDEX tasks_status_position;
CREATE INDEX tasks_board ON tasks(workspace_id, status, position);
CREATE INDEX users_workspace ON users(workspace_id);
CREATE INDEX activity_workspace ON activity(workspace_id, id);

-- Cascading deletes look these up; now that real workspaces persist, they need indexes.
CREATE INDEX tasks_assignee ON tasks(assignee_id);
CREATE INDEX tasks_created_by ON tasks(created_by);
CREATE INDEX comments_user ON comments(user_id);
CREATE INDEX activity_user ON activity(user_id);
