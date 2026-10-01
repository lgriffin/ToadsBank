/** Ordered schema migrations. Append a new entry for every change; never edit one that has shipped. */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    // Every repository is a typed collection of JSON documents keyed by (kind, id). Lookups by field use jsonb
    // containment, served by the GIN index. A guild's bank is small, so this stays fast and keeps one code path.
    id: '0001_documents',
    sql: `
      CREATE TABLE documents (
        kind text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX documents_data ON documents USING gin (data jsonb_path_ops);
    `,
  },
];
