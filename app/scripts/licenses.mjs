// Lists the open-source packages that end up in the app with their licenses, for the "Лицензии" page.
// Runs before every build; the result is committed so the dev server has it too.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8'))

// the app's own dependencies and everything they pull in, without build tools
const wanted = new Set()
const queue = Object.keys(pkg.dependencies ?? {})
while (queue.length) {
  const name = queue.shift()
  if (wanted.has(name)) continue
  wanted.add(name)
  const entry = lock.packages[`node_modules/${name}`]
  for (const dep of Object.keys({ ...(entry?.dependencies ?? {}), ...(entry?.optionalDependencies ?? {}) })) queue.push(dep)
}

const out = []
for (const name of [...wanted].sort()) {
  const dir = join(root, 'node_modules', name)
  const file = join(dir, 'package.json')
  if (!existsSync(file)) continue
  const p = JSON.parse(readFileSync(file, 'utf-8'))
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url
  out.push({
    name,
    version: p.version,
    license: typeof p.license === 'string' ? p.license : p.license?.type ?? (p.licenses?.map?.((l) => l.type).join(' / ') || 'см. пакет'),
    url: (p.homepage || repo || `https://www.npmjs.com/package/${name}`).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://'),
  })
}

mkdirSync(join(root, 'src', 'generated'), { recursive: true })
writeFileSync(join(root, 'src', 'generated', 'licenses.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`licenses: ${out.length} packages`)
