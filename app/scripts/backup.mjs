// Saves every account's synced data and stats to a local JSON file before a schema change.
// node scripts/backup.mjs <file> (connection string from ANYFLOW_DB)
import { writeFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) throw new Error('usage: node scripts/backup.mjs <file>')
const client = new pg.Client({ connectionString: process.env.ANYFLOW_DB, ssl: { rejectUnauthorized: false } })
await client.connect()
const out = {}
for (const t of ['profiles', 'user_docs', 'watch_stats', 'ratings', 'comments']) out[t] = (await client.query(`select * from public.${t}`)).rows
writeFileSync(file, JSON.stringify(out, null, 1))
console.log(Object.entries(out).map(([t, r]) => `${t}: ${r.length}`).join(', '))
await client.end()
