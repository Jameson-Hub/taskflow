-- Deleted accounts are anonymised rather than removed: deleting the row would cascade
-- away the person's activity history, comments and the tasks they created.
ALTER TABLE users ADD COLUMN deleted_at TEXT;

-- 0002's deploy-window safety net. Every release since sets workspace_id itself.
DROP TRIGGER users_default_workspace;
DROP TRIGGER tasks_default_workspace;
DROP TRIGGER activity_default_workspace;
