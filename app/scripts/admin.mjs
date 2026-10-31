// Gives an account a role: node scripts/admin.mjs <username> [admin|moderator|user]
// The connection string comes from ANYFLOW_DB, never from the repository.
import pg from 'pg'

const [username, role = 'admin'] = process.argv.slice(2)
if (!username || !['admin', 'moderator', 'user'].includes(role)) throw new Error('usage: node scripts/admin.mjs <username> [admin|moderator|user]')
const client = new pg.Client({ connectionString: process.env.ANYFLOW_DB, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(`select set_config('anyflow.staff', 'on', false)`)
const { rowCount } = await client.query('update public.profiles set role = $1 where username = $2', [role, username.toLowerCase()])
console.log(rowCount ? `${username} is now ${role}` : `no account ${username}`)
await client.end()
