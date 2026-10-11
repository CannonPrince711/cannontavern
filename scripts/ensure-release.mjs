// Creates the GitHub release for package.json's version before electron-builder
// uploads to it. Build targets publish in parallel, and when the release doesn't
// exist yet they race to create it: GitHub accepts one and rejects the rest
// ("Published releases must have a valid tag"), so files go missing.
// Needs GH_TOKEN (or GITHUB_TOKEN). Prints nothing secret.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

async function main() {
  const root = new URL('../', import.meta.url)
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  const config = readFileSync(new URL('electron-builder.yml', root), 'utf8')
  const owner = /^\s*owner:\s*(\S+)/m.exec(config)?.[1]
  const repo = /^\s*repo:\s*(\S+)/m.exec(config)?.[1]
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!owner || !repo) throw new Error('electron-builder.yml has no publish owner/repo.')
  if (!token) throw new Error('Set GH_TOKEN to a GitHub token that can create releases.')

  const tag = `v${version}`
  const api = `https://api.github.com/repos/${owner}/${repo}`
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'dnd-tavern-release' }

  // Drafts aren't found by tag, so look through the recent releases.
  const list = await fetch(`${api}/releases?per_page=50`, { headers })
  if (!list.ok) throw new Error(`GitHub said ${list.status} when listing releases: ${await list.text()}`)
  if ((await list.json()).some((r) => r.tag_name === tag)) return `Release ${tag} already exists; uploading to it.`

  let commit = ''
  try {
    commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // not a git checkout: GitHub tags the default branch
  }
  // Tag the commit being built when GitHub has it; otherwise the default branch.
  for (const target of commit ? [commit, ''] : ['']) {
    const res = await fetch(`${api}/releases`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: version, ...(target ? { target_commitish: target } : {}) })
    })
    if (res.ok) return `Created release ${tag}.`
    if (res.status !== 422 || !target) throw new Error(`GitHub said ${res.status} when creating ${tag}: ${await res.text()}`)
  }
}

// No process.exit(): on Windows it can abort while fetch's sockets are closing.
main().then(
  (message) => console.log(message),
  (err) => {
    console.error(err.message)
    process.exitCode = 1
  }
)
