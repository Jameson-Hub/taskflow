-- When a task was finished, for the dashboard's weekly trend and time-to-finish.
-- Tasks already done get their last update time, the closest record there is.
ALTER TABLE tasks ADD COLUMN completed_at TEXT;
UPDATE tasks SET completed_at = updated_at WHERE status = 'done';
