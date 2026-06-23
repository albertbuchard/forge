ALTER TABLE psyche_devrage_conversation_measures
  ADD COLUMN max_cumulative_rage REAL NOT NULL DEFAULT 0;

ALTER TABLE psyche_devrage_conversation_measures
  ADD COLUMN max_swearing_streak INTEGER NOT NULL DEFAULT 0;
