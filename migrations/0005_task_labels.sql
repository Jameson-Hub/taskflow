-- Free-text labels on a task, as a JSON array of lowercase strings. One column keeps them a
-- plain task field: edited, logged and deleted with the task, with nothing extra to manage.
ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
