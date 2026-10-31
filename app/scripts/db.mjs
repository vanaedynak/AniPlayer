// Applies supabase/schema.sql to the database. The connection string comes from the environment
// (ANYFLOW_DB), never from the repository.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.ANYFLOW_DB
if (!url) throw new Error('Set ANYFLOW_DB to the Supabase session pooler connection string')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf-8'))
const { rows } = await client.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)
console.log('schema applied:', rows.map((r) => r.tablename).join(', '))
await client.end()
