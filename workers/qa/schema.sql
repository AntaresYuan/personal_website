CREATE TABLE IF NOT EXISTS qa_traces (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  trajectory TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS qa_traces_expires_at ON qa_traces (expires_at);
