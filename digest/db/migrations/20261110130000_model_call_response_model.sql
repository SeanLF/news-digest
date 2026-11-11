-- migrate:up

-- The models that served a call, as the SDK result's modelUsage names them, the costliest first and
-- comma-separated; request_model is the one the spec asked for. NULL is a call with no result (an
-- abort) or a row recorded before this was kept.
ALTER TABLE model_calls ADD COLUMN response_model text;

-- migrate:down

ALTER TABLE model_calls DROP COLUMN response_model;
