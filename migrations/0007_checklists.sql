-- A task's checklist, as a JSON array of { text, done }. Like labels, one column keeps it a plain
-- task field: same edit rules, logged, deleted with the task.
ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]';
