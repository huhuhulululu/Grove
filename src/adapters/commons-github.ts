/**
 * commons-github.ts — READ-ONLY GitHub client for the commons (ADR-0013).
 *
 * Lists curated `commons`-labelled issues and checks a PR's merge state via the
 * public GitHub REST API. GET-ONLY by construction: it NEVER writes, NEVER opens
 * a PR, NEVER runs contributor code (GitHub Actions does that). The CLI prints the
 * exact commands the user runs under their OWN identity.
 *
 * ETHICS (ADR-0005 / ADR-0013):
 *  - read-only: no POST/PUT/PATCH, no child_process / exec.
 *  - token is OPTIONAL (GROVE_GITHUB_TOKEN) — only raises the anon rate limit;
 *    it is NEVER persisted.
 *  - a network failure resolves to [] / { merged:false }, never crashes the CLI.
 */

import * as https from 'node:https'

/** A claimable commons task, normalized from a GitHub issue (pure data). */
export interface CommonsTask {
  number: number
  title: string
  labels: string[]
  url: string
}

/** GET-only JSON fetch from the GitHub REST API. Resolves null on any failure. */
function githubGet(apiPath: string, token?: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const req = https.request(
        `https://api.github.com${apiPath}`,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'grove-commons',
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            try {
              resolve(res.statusCode === 200 ? JSON.parse(body) : null)
            } catch {
              resolve(null)
            }
          })
        },
      )
      req.on('error', () => resolve(null))
      req.end()
    } catch {
      resolve(null)
    }
  })
}

/** The optional GitHub token (raises the anon rate limit). Never persisted. */
export function commonsToken(): string | undefined {
  const token = process.env['GROVE_GITHUB_TOKEN']
  return token !== undefined && token.length > 0 ? token : undefined
}

/** List open `commons`-labelled issues (excludes PRs). Returns [] on failure. */
export async function listCommonsIssues(repo: string, token?: string): Promise<CommonsTask[]> {
  const data = await githubGet(`/repos/${repo}/issues?labels=commons&state=open`, token)
  if (!Array.isArray(data)) return []
  return data
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === 'object' && x !== null && !('pull_request' in x),
    )
    .map((it) => ({
      number: typeof it['number'] === 'number' ? it['number'] : 0,
      title: typeof it['title'] === 'string' ? it['title'] : '',
      labels: Array.isArray(it['labels'])
        ? (it['labels'] as unknown[])
            .map((l) =>
              typeof l === 'object' && l !== null && typeof (l as Record<string, unknown>)['name'] === 'string'
                ? ((l as Record<string, unknown>)['name'] as string)
                : '',
            )
            .filter((s) => s.length > 0)
        : [],
      url: typeof it['html_url'] === 'string' ? it['html_url'] : '',
    }))
}

/** Whether a PR is merged (the only signal that justifies a commons reward). */
export async function prMergeState(repo: string, prNumber: number, token?: string): Promise<{ merged: boolean }> {
  const data = await githubGet(`/repos/${repo}/pulls/${prNumber}`, token)
  const merged =
    typeof data === 'object' && data !== null && (data as Record<string, unknown>)['merged'] === true
  return { merged }
}
