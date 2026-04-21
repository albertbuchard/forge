ALTER TABLE agent_tokens
  ADD COLUMN bootstrap_policy_json TEXT NOT NULL DEFAULT '{"mode":"full","goalsLimit":25,"projectsLimit":25,"tasksLimit":25,"habitsLimit":20,"strategiesLimit":20,"peoplePageLimit":12,"includePeoplePages":true}';
