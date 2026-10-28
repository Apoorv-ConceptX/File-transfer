CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text NOT NULL, name text NOT NULL, refresh_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), title text NOT NULL, kind text NOT NULL,
 config jsonb NOT NULL, status text NOT NULL DEFAULT 'scanning', phase text NOT NULL DEFAULT 'scan',
 generation integer NOT NULL DEFAULT 1, sequence integer NOT NULL DEFAULT 0, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS scan_queue (
 id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 folder_id text NOT NULL, relative_path text NOT NULL, page_token text, selected_rows jsonb NOT NULL DEFAULT '[]', done boolean NOT NULL DEFAULT false,
 UNIQUE(job_id, folder_id)
);
CREATE TABLE IF NOT EXISTS items (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 source_id text NOT NULL, name text NOT NULL, relative_path text NOT NULL, target_path text NOT NULL,
 mime_type text NOT NULL, bytes bigint, checksum text, metadata jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', error text, destination_id text,
 UNIQUE(job_id, source_id)
);
CREATE INDEX IF NOT EXISTS items_job_status ON items(job_id, status);
CREATE TABLE IF NOT EXISTS selection_matches (
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, row_index integer NOT NULL,
 item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id, row_index, item_id)
);
CREATE INDEX IF NOT EXISTS selection_lookup ON selection_matches(job_id, item_id);
CREATE TABLE IF NOT EXISTS destination_folders (
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, path text NOT NULL, folder_id text NOT NULL,
 PRIMARY KEY(job_id, path)
);
CREATE TABLE IF NOT EXISTS job_ticks (
 job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, generation integer NOT NULL, sequence integer NOT NULL,
 outcome jsonb NOT NULL, PRIMARY KEY(job_id,generation,sequence)
);
