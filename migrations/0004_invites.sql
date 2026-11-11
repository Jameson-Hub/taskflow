-- Single-use links an admin shares so people can join a workspace with their own password.
CREATE TABLE invites (
  -- SHA-256 of the token in the link, like sessions.
  id           TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'member')),
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL
);
CREATE INDEX invites_workspace ON invites(workspace_id);
CREATE INDEX invites_created_by ON invites(created_by);
