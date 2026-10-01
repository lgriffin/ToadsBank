import pg from 'pg';

/** A pool on a throwaway schema, so every run starts clean and parallel runs never meet. */
export async function scratchPool(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const url = process.env.TOADSBANK_TEST_DATABASE_URL;
  if (!url) throw new Error('TOADSBANK_TEST_DATABASE_URL is required for integration tests');
  const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 10, options: `-c search_path=${schema}` });
  return {
    pool,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
