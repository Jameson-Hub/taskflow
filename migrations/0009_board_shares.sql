-- A read-only link to a workspace's board, one per workspace. An admin makes, resets or turns it off.
CREATE TABLE board_shares (
  -- SHA-256 of the token in the link, like invites and sessions.
  id           TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Deleted when this person stops being an admin or leaves, like their invites.
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX board_shares_created_by ON board_shares(created_by);
