ALTER TABLE agent_tokens
  ADD COLUMN scope_policy_json TEXT NOT NULL DEFAULT '{"userIds":[],"projectIds":[],"tagIds":[]}';
