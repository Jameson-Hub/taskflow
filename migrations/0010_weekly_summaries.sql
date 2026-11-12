-- Each workspace's week in numbers, written on Monday night by the queue consumer (src/worker/weekly.ts).
CREATE TABLE weekly_summaries (
  workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The Monday the week ends on (exclusive), YYYY-MM-DD. One row per week, so a redelivered message changes nothing.
  week_end        TEXT NOT NULL,
  created         INTEGER NOT NULL,
  finished        INTEGER NOT NULL,
  comments        INTEGER NOT NULL,
  busiest_name    TEXT,
  busiest_changes INTEGER,
  PRIMARY KEY (workspace_id, week_end)
);

-- The Monday job finds the week's active workspaces by date, then counts each one's week.
CREATE INDEX activity_created ON activity(created_at);
CREATE INDEX activity_workspace_created ON activity(workspace_id, created_at);
