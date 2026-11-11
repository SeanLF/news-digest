-- migrate:up

-- How much work a model call did: the agent loop's turns (the SDK result's num_turns) and the tool
-- calls the model made. NULL is a row recorded before these were kept.
ALTER TABLE model_calls ADD COLUMN num_turns integer, ADD COLUMN tool_calls integer;

-- migrate:down

ALTER TABLE model_calls DROP COLUMN num_turns, DROP COLUMN tool_calls;
