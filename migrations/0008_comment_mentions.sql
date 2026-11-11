-- Who a comment @mentions, as a JSON array of user ids, for the board's "mentions me" filter.
ALTER TABLE comments ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';
