import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { AgencyStats, GitInfo } from '../types'
import { makeColors } from './make-colors.js'

const PANE = 'agency'
const EMPTY: AgencyStats = { isSetUp: false, outbox: 0, clients: [], proposals: 0, queue: 0, replies: 0 }

const agency = atom({ plugin: 'schrotty', key: 'agency' } as const, EMPTY, { shape: 'agency-1' })
const git = atom({ plugin: 'schrotty', key: 'git' } as const, null, { shape: 'git-1' })
const isBandHidden = atom({ plugin: 'schrotty', key: 'isBandHidden' } as const, false)

// --- Look: rusty orange on steel grays ---------------------------------------
const { theme, problems } = makeColors({
  label: 'Schrott',
  roles: { accent: '#c2571a', danger: '#b8322a', success: '#4f7d3c', warning: '#b07a12', pro: '#5d6f8a' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e3e5e6',
        'surface-1': '#eceeef',
        'surface-2': '#f4f5f6',
        'text-primary': '#1d2124',
        'text-secondary': '#41474c',
        'text-muted': '#5a6167',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#16191b',
        'surface-1': '#1d2124',
        'surface-2': '#24292c',
        'surface-3': '#2b3034',
        'text-primary': '#eceae6',
        'text-secondary': '#c4c1bb',
        'text-muted': '#a09c95',
      },
    },
  },
})
const LOOK: ThemeSetArgs = { colors: theme }

// --- Guard: commands that are hard to undo -----------------------------------
const GUARDS: { test: RegExp; why: string }[] = [
  { test: /\bgit\s+push\b.*\s(--force|-f)(\s|$)/, why: 'Force-Push ist gesperrt.' },
  { test: /\bgit\s+push\b.*\b(main|master)\b/, why: 'Push auf main/master ist gesperrt.' },
  { test: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(\/|~|\$HOME|\.\.)(\s|\/?$)/, why: 'rm -rf auf /, ~ oder .. ist gesperrt.' },
]

// --- Reading the world -------------------------------------------------------
async function count($: EngineInterface, dir: string): Promise<number> {
  if (!(await $.fs.exists(dir))) return 0
  return (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md')).length
}

async function readAgency($: EngineInterface): Promise<AgencyStats> {
  if (!(await $.fs.exists('.agency/AGENCY.md'))) return EMPTY
  const clients = (await $.fs.exists('.agency/clients'))
    ? (await $.fs.list('.agency/clients')).filter(f => f.kind === 'dir').map(f => f.name)
    : []
  let proposals = 0
  for (const c of clients) {
    if (await $.fs.exists(`.agency/clients/${c}/PROPOSAL.md`)) proposals += 1
  }
  let queue = 0
  if (await $.fs.exists('.agency/queue.md')) {
    const text = await $.fs.read('.agency/queue.md')
    queue = text.split('\n').filter(l => /^\s*[-*]\s*\[ \]/.test(l)).length
  }
  return {
    isSetUp: true,
    outbox: await count($, '.agency/outbox'),
    clients,
    proposals,
    queue,
    replies: await count($, '.agency/support/replies'),
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const stats = await readAgency($)
    await update($, agency, () => stats)
  } catch {
    await update($, agency, () => EMPTY)
  }
  const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await $.process.run(['git', 'status', '--porcelain'])
  const info: GitInfo =
    branch.exitCode === 0
      ? { branch: branch.stdout.trim(), changed: status.stdout.split('\n').filter(l => l.trim()).length }
      : null
  await update($, git, () => info)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.toast(unpainted)
    await $.theme.set(LOOK)

    await $.command.register({ name: 'agency-panel', description: 'Agency-Panel neben dem Chat öffnen' })
    void $.ui.open({ id: PANE, title: 'Agency' })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'agency-panel' }, async ($) => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Agency' })
    return { text: 'Agency-Panel geöffnet.' }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const hit = GUARDS.find(g => g.test.test(e.command))
    if (hit !== undefined) {
      $.ui.toast(`Schutz: ${hit.why}`)
      return { deny: `schrotty: ${hit.why} Bitte den Menschen fragen und es selbst ausführen lassen.` }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'schrotty: der Schutz-Hook ist ausgefallen.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, agency)

    if (!s.isSetUp) {
      return (
        <Box flexDirection="column">
          <Text bold>Agency</Text>
          <Text dimColor>Noch nicht eingerichtet. Starte mit /agency setup.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Agency</Text>
        <Text>Entwürfe im Outbox: {s.outbox}</Text>
        <Text>Kunden: {s.clients.length === 0 ? '–' : s.clients.join(', ')}</Text>
        <Text>Angebote: {s.proposals}</Text>
        <Text>Support-Antworten: {s.replies}</Text>
        <Text>Offen in der Queue: {s.queue}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const info = await read($, git)
    if (e.props.hasSurvey || info === null || (await read($, isBandHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          ⎇ {info.branch} · {info.changed === 0 ? 'sauber' : `${info.changed} geändert`}{' '}
        </Text>
        <Button key="hide" label="Ausblenden" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}
