import { Pool } from 'pg';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    process.stderr.write(
      'DATABASE_URL is not set. Free-stack proof needs Neon credentials.\n',
    );
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true } });

  try {
    await pool.query(
      'create table if not exists _phase0_check (id integer primary key, checked_at timestamptz not null default now())',
    );
    await pool.query('insert into _phase0_check (id) values (1) on conflict (id) do nothing');
    const result = await pool.query<{ n: number }>(
      'select count(*)::int as n from _phase0_check',
    );
    process.stdout.write(`Neon connection OK. _phase0_check rows: ${result.rows[0]?.n ?? 0}\n`);
  } catch (error) {
    process.stderr.write(
      `Neon proof failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
