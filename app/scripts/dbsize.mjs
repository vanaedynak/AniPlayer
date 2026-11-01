// Shows how much of the database each table takes and how big an account's data is.
// node scripts/dbsize.mjs (connection string from ANYFLOW_DB)
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.ANYFLOW_DB, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql) => (await client.query(sql)).rows
console.log('database:', (await q(`select pg_size_pretty(pg_database_size(current_database())) as s`))[0].s)
console.table(await q(`
  select n.nspname || '.' || c.relname as table, c.reltuples::bigint as rows,
    pg_size_pretty(pg_total_relation_size(c.oid)) as total, pg_total_relation_size(c.oid) as bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'auth', 'storage', 'realtime')
  order by bytes desc limit 25`))
console.table(await q(`
  select kind, count(*) as docs, sum(pg_column_size(data)) as data_bytes, round(avg(pg_column_size(data))) as avg_bytes, max(pg_column_size(data)) as max_bytes
  from public.user_docs group by kind order by 3 desc`))
console.table(await q(`select bucket_id, count(*) as files, pg_size_pretty(sum((metadata->>'size')::bigint)) as size from storage.objects group by 1`))
await client.end()
