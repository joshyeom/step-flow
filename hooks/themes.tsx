import type { Elements } from 'claude-code'

import type { StepNode, StepStatus } from '../types'
import type { Strings } from './i18n'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
export type Ctx = {
  ui: Ui
  list: StepNode[]
  // Every node, before the size guard hides old ones (summary and bar counts use this).
  all: StepNode[]
  width: number
  t: Strings
  select: (id: string) => unknown
  // The pane's "choose" button on a decision: node and option index.
  decide: (n: StepNode, i: number) => unknown
  // The pane's body is a window over these rows (docked): theme 1 then draws its border row by row.
  pinned: boolean
}

// One piece of a view with the rows it takes (an estimate), so a window can cut between pieces.
export type El = ReturnType<Ui['Text']>
// `pin`: stays above the scrolling window (the docked pane's fixed header rows).
// `focus`: keys of the focusable elements in it (the window moves to keep the focused row and its neighbours in view).
export type Unit = { rows: number; el: El; pin?: true; focus?: string[] }

const pad2 = (n: number) => String(n).padStart(2, '0')
export const hhmm = (ts: number) => {
  const d = new Date(ts)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// Terminal cells as the engine (string-width) draws them: wide characters (Hangul, CJK, emoji) take two,
// combining marks none, the rest one; a character followed by U+FE0F (emoji presentation) takes two.
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f2ff], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]
const ZERO: [number, number][] = [[0x300, 0x36f], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f]]
const within = (cp: number, ranges: [number, number][]) => ranges.some(([from, to]) => cp >= from && cp <= to)
export const cells = (s: string) => {
  const chars = [...s]

  return chars.reduce((w, ch, i) => {
    const cp = ch.codePointAt(0) ?? 0
    if (within(cp, ZERO)) return w

    return w + (cp >= 0x300 && within(cp, WIDE) ? 2 : chars[i + 1] === '\uFE0F' ? 2 : 1)
  }, 0)
}

// Rows a text takes when wrapped at spaces in `width` cells (long words split).
export const wrapRows = (s: string, width: number) => {
  const cols = Math.max(1, width)
  let rows = 1
  let used = 0
  for (const word of s.split(' ')) {
    const w = cells(word)
    if (used === 0) used = w
    else if (used + 1 + w <= cols) used += 1 + w
    else {
      rows++
      used = w
    }
    while (used > cols) {
      rows++
      used -= cols
    }
  }

  return rows
}

// The lines wrapRows counts: the same rule (words at spaces, a long word cut at `width` cells).
export const wrapLines = (s: string, width: number) => {
  const cols = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const word of s.split(' ')) {
    const w = cells(word)
    if (used === 0) {
      line = word
      used = w
    } else if (used + 1 + w <= cols) {
      line += ` ${word}`
      used += 1 + w
    } else {
      lines.push(line)
      line = word
      used = w
    }
    while (used > cols) {
      let take = 0
      let c = 0
      // a character and its variation selector are one cluster, counted as cells() counts them
      for (const ch of line.match(/[\s\S]\uFE0F?/gu) ?? []) {
        const cw = cells(ch)
        if (take > 0 && c + cw > cols) break
        c += cw
        take += ch.length
      }
      lines.push(line.slice(0, take))
      line = line.slice(take)
      used = cells(line)
    }
  }
  lines.push(line)

  return lines
}

// `s` filled with spaces up to `width` cells.
export const padCells = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - cells(s)))

// Look of a step: done and resolved are success; a decision waits (warning) until decided; a blocked step is
// an error, a deferred one is gray, and a failure the user has already chosen for is gray too.
type Look = { color: 'success' | 'error' | 'warning' | 'inactive'; glyph: string }
const OK: Look = { color: 'success', glyph: '✓' }
export const STATUS: Record<StepStatus, Look> = {
  done: OK,
  resolved: OK,
  deferred: { color: 'inactive', glyph: '‖' },
  blocked: { color: 'error', glyph: '✗' },
  decision: { color: 'warning', glyph: '?' },
}
// Nodes kept in state by an earlier version: unresolved is blocked, workaround is resolved.
const LEGACY: Record<string, StepStatus> = { unresolved: 'blocked', workaround: 'resolved' }
export const norm = (n: StepNode): StepNode => {
  const status = LEGACY[n.status as string]

  return status ? { ...n, status } : n
}
export const isFailure = (n: StepNode) => n.status === 'deferred' || n.status === 'blocked'
// An open choice: a pending decision, or a failure with options the user has not picked from yet.
export const isOpen = (n: StepNode) =>
  n.status === 'decision' ? !n.decided : isFailure(n) && (n.options?.length ?? 0) > 0 && !n.chosen
// Never trimmed or hidden: open choices, and failures not resolved and not chosen (`resolve` needs their ids).
export const isKept = (n: StepNode) => isOpen(n) || (isFailure(n) && !n.chosen)
export const look = (n: StepNode): Look =>
  n.status === 'decision' && n.decided ? OK : isFailure(n) && n.chosen ? { ...STATUS[n.status], color: 'inactive' } : STATUS[n.status]
// Color in the theme 3 bar and theme 4 cells: an open choice is yellow wherever it came from.
export const barColor = (n: StepNode): Look['color'] => (isOpen(n) ? 'warning' : look(n).color)
// The status word (detail badge, Q&A log).
export const word = (t: Strings, n: StepNode) =>
  n.status === 'decision'
    ? n.decided
      ? t.decided
      : t.needsDecision
    : n.status === 'blocked'
      ? t.blocked
      : n.status === 'deferred'
        ? t.deferred
        : t.ok
// The list tag: an open choice first, then a chosen failure, else the status word.
export const label = (t: Strings, n: StepNode) =>
  isFailure(n) && isOpen(n) ? t.needsDecision : isFailure(n) && n.chosen ? t.chosen : word(t, n)
export const tagColor = (n: StepNode): Look['color'] => (isFailure(n) && isOpen(n) ? 'warning' : look(n).color)
// Failure and decision steps carry a tag in the list views; success shows none.
const tagged = (n: StepNode) => isFailure(n) || n.status === 'decision'
export const letter = (i: number) => String.fromCharCode(65 + i)

export const THEME_IDS: readonly number[] = [1, 2, 3, 4, 5, 7]


const CUT = 300
// List views cut long texts; the detail view does not use this.
export const cut = (s: string) => (s.length <= CUT ? s : `${s.slice(0, CUT)}…`)

const causeLabel = (t: Strings, n: StepNode) => (isFailure(n) ? t.cause : t.problem)
// The line only a deferred step has: why it is fine to move on.
const noteLine = (t: Strings, n: StepNode): [string, string] | undefined =>
  n.status === 'deferred' ? [t.okReason, n.okReason || '—'] : undefined
const fixLabel = (t: Strings, n: StepNode) => (n.resolvedAt ? t.fixAt(hhmm(n.resolvedAt)) : t.fix)

// Cause, why OK, the work not done, every attempt (action, then its reason below) and fix as blocks, each after a blank line (list views).
export const fields = ({ ui: { Box, Text }, t }: Ctx, n: StepNode) => {
  if (!hasFields(n)) return []
  const dim = (s: string) => <Text color="inactive">{s}</Text>
  const c = cut
  const block = (...rows: ReturnType<typeof Text>[]) => (
    <Box flexDirection="column" marginTop={1}>{rows}</Box>
  )
  const rows = []
  if (n.cause) {
    rows.push(
      block(
        <Text>
          {dim(`${causeLabel(t, n)}: `)}
          {c(n.cause)}
        </Text>,
      ),
    )
  }
  const note = noteLine(t, n)
  if (note) {
    rows.push(
      block(
        <Text>
          {dim(`${note[0]}: `)}
          {c(note[1])}
        </Text>,
      ),
    )
  }
  if (n.notDone?.length) {
    rows.push(block(dim(`${t.notDone}:`), ...n.notDone.map(item => <Text>{`- ${c(item)}`}</Text>)))
  }
  n.attempts?.forEach((a, i) => {
    rows.push(
      block(
        <Text>
          {dim(`${t.attempt(i + 1)}: `)}
          {c(a.action)}
        </Text>,
        dim(t.reason(c(a.reason))),
      ),
    )
  })
  if (n.fix) {
    rows.push(
      block(
        <Text>
          {dim(`${fixLabel(t, n)}: `)}
          {c(n.fix)}
        </Text>,
      ),
    )
  }

  return rows
}

// Detail view below the back button, as units: badge + title, time span, status rows, detail.
// `after`: how many steps were recorded after this one (shown under an open choice).
export const detail = (
  ctx: Ctx,
  n: StepNode,
  span: string,
  after = 0,
): Unit[] => {
  const {
    ui: { Box, Text },
    t,
    width,
    decide,
  } = ctx
  const s = look(n)
  const blocked = n.status === 'blocked'
  const failure = isFailure(n)
  const isDecision = n.status === 'decision'
  const options = n.options ?? []
  const picked = isDecision ? n.decided : n.chosen
  const note = noteLine(t, n)
  const cols = width > 0 ? width : 40
  const rule: Unit = { rows: 1, el: <Text color="subtle" wrap="truncate-end">{'─'.repeat(cols)}</Text> }
  const spacer: Unit = { rows: 1, el: <Box height={1} /> }
  const pickLabel = isDecision ? t.decisionRow : t.chosen
  const labels = [
    ...(isDecision ? [t.issue, t.meanwhile] : [...(n.cause ? [causeLabel(t, n)] : []), ...(note ? [note[0]] : []), ...(n.notDone?.length ? [t.notDone] : [])]),
    ...options.map((_, i) => letter(i)),
    ...(picked ? [pickLabel] : []),
    ...(n.attempts ?? []).map((_, i) => t.attempt(i + 1)),
    ...(n.fix ? [t.fix] : []),
    ...(n.resolvedAt ? [t.resolvedRow] : []),
    ...(n.detail ? [t.detail] : []),
  ]
  const lw = Math.max(0, ...labels.map(cells)) + 2
  // A label column, then the lines stacked in the body column; each line is [element, its text].
  const row = (
    label: string,
    body: [El, string][],
    labelColor: 'inactive' | 'error' | 'success' | 'text' = 'inactive',
  ): Unit => ({
    rows: body.reduce((sum, [, text]) => sum + wrapRows(text, cols - lw), 0),
    el: (
      <Box>
        <Box width={lw} flexShrink={0}><Text color={labelColor}>{label}</Text></Box>
        <Box flexDirection="column" flexGrow={1} minWidth={0}>{body.map(([el]) => el)}</Box>
      </Box>
    ),
  })
  // Option rows A, B, ...: the pick is marked and bright (green on a decision), the others dim.
  // An open choice has no pick yet: each option is one Button, so a press anywhere on its lines decides it.
  const optionRows = options.map((o, i) => {
    if (isOpen(n)) {
      // A label column wider than the pane leaves the text two cells at least (one wide character).
      const ow = Math.min(lw, Math.max(0, cols - 2))
      const tw = cols - ow
      const all = [
        ...wrapLines(oneLine(o.option), tw).map(line => ({ line, bold: true })),
        ...wrapLines(oneLine(o.note), tw).map(line => ({ line, bold: false })),
      ]
      // The engine draws up to 100,000 characters of text, so the filled lines of all options share a budget.
      const maxRows = Math.max(1, Math.floor(OPTION_CHARS / options.length / (cols + 1)))
      if (all.length > maxRows) {
        const last = all[maxRows - 1]
        // Drop whole characters (a surrogate pair, or a base with its U+FE0F), never half of one.
        const chars = [...(last?.line ?? '')]
        while (chars.length && cells(chars.join('')) + 1 > tw) if (chars.pop() === '\uFE0F') chars.pop()
        all.length = maxRows
        all[maxRows - 1] = { line: `${chars.join('')}…`, bold: last?.bold ?? false }
      }
      const rows: Part[][] = all.map(({ line, bold }, j): Part[] => [
        j === 0 ? <Text color="inactive">{padCells(letter(i), ow)}</Text> : spaces(ow),
        bold ? <Text weight="bold">{line}</Text> : <Text color="inactive">{line}</Text>,
        spaces(tw - cells(line)),
      ])

      return pressUnit(ctx, `decide-${letter(i)}`, () => decide(n, i), rows)
    }
    const chosen = picked?.choice === i
    const color = picked ? (chosen ? (isDecision ? 'success' : 'text') : 'inactive') : undefined
    const optionText = chosen ? `✓ ${o.option}` : o.option

    return row(
      letter(i),
      [
        [<Text weight="bold" color={color} wrap="wrap">{optionText}</Text>, optionText],
        [<Text color={color ?? 'inactive'} wrap="wrap">{o.note}</Text>, o.note],
      ],
      color ?? 'inactive',
    )
  })
  const pickRow = picked
    ? [
        row(
          pickLabel,
          [[<Text color={isDecision ? 'success' : undefined}>{`${letter(picked.choice)} · ${hhmm(picked.ts)}`}</Text>, 'A · 00:00']],
          isDecision ? 'success' : 'inactive',
        ),
      ]
    : []
  // On an open choice, a line telling how many steps came after it.
  const buttons: Unit[] =
    isOpen(n) && after > 0
      ? [{ rows: wrapRows(t.stepsAfter(after), cols), el: <Text color="inactive" wrap="wrap">{t.stepsAfter(after)}</Text> }]
      : []
  const attemptRows = (n.attempts ?? []).map((a, i) =>
    row(t.attempt(i + 1), [
      [<Text wrap="wrap">{a.action}</Text>, a.action],
      [<Text color="inactive" wrap="wrap">{t.reason(a.reason)}</Text>, t.reason(a.reason)],
    ]),
  )
  const statusGroups: Unit[][] = isDecision
    ? [
        [row(t.issue, [[<Text wrap="wrap">{n.cause ?? ''}</Text>, n.cause ?? '']])],
        optionRows,
        [row(t.meanwhile, [[<Text wrap="wrap">{n.interim ?? ''}</Text>, n.interim ?? '']])],
        pickRow,
        buttons,
      ]
    : [
        n.cause
          ? [row(causeLabel(t, n), [[<Text wrap="wrap">{n.cause}</Text>, n.cause]], blocked ? 'error' : 'inactive')]
          : [],
        note ? [row(note[0], [[<Text wrap="wrap">{note[1]}</Text>, note[1]]])] : [],
        // one unit per item so a long list scrolls; the label stands on the first
        (n.notDone ?? []).map((item, i) =>
          row(i === 0 ? t.notDone : '', [[<Text wrap="wrap">{`- ${item}`}</Text>, `- ${item}`]]),
        ),
        attemptRows,
        n.fix ? [row(t.fix, [[<Text wrap="wrap">{n.fix}</Text>, n.fix]])] : [],
        n.resolvedAt
          ? [row(t.resolvedRow, [[<Text>{hhmm(n.resolvedAt)}</Text>, hhmm(n.resolvedAt)]])]
          : [],
        failure ? optionRows : [],
        pickRow,
        buttons,
      ]
  const groups = statusGroups.filter(g => g.length)
  const badge = ` ${word(t, n)} `
  const units: Unit[] = [
    {
      rows: wrapRows(n.title, cols - cells(badge) - 1),
      el: (
        <Box columnGap={1}>
          <Box flexShrink={0}>
            <Text color={s.color} weight="bold" inverse>{badge}</Text>
          </Box>
          <Text weight="bold" wrap="wrap">{n.title}</Text>
        </Box>
      ),
    },
    { rows: 1, el: <Text color="inactive">{span}</Text> },
    rule,
  ]
  groups.forEach((g, i) => {
    if (i > 0) units.push(spacer)
    units.push(...g)
  })
  // A rule only where something sits between it and the one above.
  if (n.detail) {
    if (groups.length > 0) units.push(rule)
    // One row unit per line so the window can reach the end of a long detail.
    // ponytail: a single line taller than the window still cannot be scrolled inside; split by width if it matters.
    n.detail.split('\n').forEach((line, i) => {
      units.push(row(i === 0 ? t.detail : '', [[<Text wrap="wrap">{line || ' '}</Text>, line]]))
    })
  }

  return units
}

// List looks are v0.1's: undocked one tree each, docked the same look as line-level units so the window
// can stop between any two lines. Failed, resolved and workaround steps expand their fields; decisions do not.
const hasFields = (n: StepNode) => n.status !== 'done' && n.status !== 'decision'
const tagW = ({ t }: Ctx, n: StepNode) => (tagged(n) ? 1 + cells(label(t, n)) + 2 : 0)
const col = (ch: string, rows: number) => Array(rows).fill(ch).join('\n')

// A piece left of a title: a string, or [text, color, mono] drawn as a Text.
type Piece = string | [text: string, color: Look['color'], mono?: true]
type Part = string | El
// Characters all the filled option lines of one open choice may draw together.
const OPTION_CHARS = 60000
const spaces = (n: number) => ' '.repeat(Math.max(0, n))
const oneLine = (s: string) => s.replace(/\s+/g, ' ')

// Rows of parts as a Button's children: a newline between rows, neighbouring strings merged.
const joinRows = (rows: Part[][]) => {
  const out: Part[] = []
  rows.forEach((row, i) => {
    for (const p of i > 0 ? ['\n', ...row] : row) {
      const last = out[out.length - 1]
      if (p === '') continue
      if (typeof p === 'string' && typeof last === 'string') out[out.length - 1] = last + p
      else out.push(p)
    }
  })

  return out
}

// Lines as ONE Button, so a press anywhere on them calls onPress. Every row is padded with
// spaces to the Button's width by the caller; children are only strings and Text.
const pressUnit = ({ ui: { Button } }: Ctx, key: string, onPress: () => void, rows: Part[][]): Unit => ({
  rows: rows.length,
  el: (
    <Button plain key={key} onPress={onPress}>
      {joinRows(rows)}
    </Button>
  ),
  focus: [key],
})

// A step's title lines as one Button that opens the step.
const lineButton = (ctx: Ctx, n: StepNode, rows: Part[][]): Unit => pressUnit(ctx, n.id, () => ctx.select(n.id), rows)

// An unresolved blocked title is red and bold; others are plain text.
const titleText = ({ ui: { Text } }: Ctx, n: StepNode, line: string): Part =>
  n.status === 'blocked' && !n.chosen ? <Text color="error" weight="bold">{line}</Text> : line

// [prefix][title block][space][label tag (failed and decision only)], padded to `width`. The title wraps in what
// is left of `width` after the prefix and the tag; the title block is as wide as its longest line.
const rowButton = (ctx: Ctx, n: StepNode, width: number, prefix: Piece[]): Unit => {
  const { Text } = ctx.ui
  const lead = prefix.map(p =>
    typeof p === 'string' ? p : <Text color={p[1]} {...(p[2] ? { mono: true as const } : {})}>{p[0]}</Text>,
  )
  const pw = prefix.reduce((w, p) => w + cells(typeof p === 'string' ? p : p[0]), 0)
  const tw = tagW(ctx, n)
  // Whitespace runs (newlines too) become one space, so the drawn lines are the ones counted.
  const lines = wrapLines(oneLine(n.title), width - pw - tw)
  const block = Math.max(...lines.map(cells))
  const rows = lines.map((line, i): Part[] => {
    if (i > 0) return [spaces(pw), titleText(ctx, n, line), spaces(width - pw - cells(line))]
    if (!tagged(n)) return [...lead, titleText(ctx, n, line), spaces(width - pw - cells(line))]

    return [
      ...lead,
      titleText(ctx, n, line),
      spaces(block - cells(line) + 1),
      <Text color={tagColor(n)} weight="bold" inverse>{` ${label(ctx.t, n)} `}</Text>,
      spaces(width - pw - block - tw),
    ]
  })

  return lineButton(ctx, n, rows)
}

// glyph, time: the prefix of a title in themes 1 to 4
const glyphLead = (n: StepNode, glyph = look(n).glyph): Piece[] => [[glyph, look(n).color], ' ', [n.at, 'inactive'], ' ']

// Docked: the fields of fields() as one unit per line (same blocks, a blank row before each).
const fieldUnits = ({ ui: { Box, Text }, t }: Ctx, n: StepNode, avail: number): Unit[] => {
  if (!hasFields(n)) return []
  const out: Unit[] = []
  const gap = () => out.push({ rows: 1, el: <Box height={1} /> })
  const dimmed = (s: string) => <Text color="inactive">{s}</Text>
  const line = (label: string, body: string) =>
    out.push({ rows: wrapRows(label + body, avail), el: <Text>{dimmed(label)}{body}</Text> })
  if (n.cause) {
    gap()
    line(`${causeLabel(t, n)}: `, cut(n.cause))
  }
  const note = noteLine(t, n)
  if (note) {
    gap()
    line(`${note[0]}: `, cut(note[1]))
  }
  if (n.notDone?.length) {
    gap()
    out.push({ rows: 1, el: dimmed(`${t.notDone}:`) })
    for (const item of n.notDone) {
      out.push({ rows: wrapRows(`- ${cut(item)}`, avail), el: <Text>{`- ${cut(item)}`}</Text> })
    }
  }
  n.attempts?.forEach((a, i) => {
    gap()
    line(`${t.attempt(i + 1)}: `, cut(a.action))
    out.push({ rows: wrapRows(t.reason(cut(a.reason)), avail), el: dimmed(t.reason(cut(a.reason))) })
  })
  if (n.fix) {
    gap()
    line(`${fixLabel(t, n)}: `, cut(n.fix))
  }

  return out
}

const gapUnit = ({ ui: { Box } }: Ctx): Unit => ({ rows: 1, el: <Box height={1} /> })
const whole = (el: El): Unit[] => [{ rows: 1, el }]

// A card drawn row by row: side borders as tall as the row, edges as their own rows.
const edge = ({ ui: { Text }, width }: Ctx, color: Look['color'], l: string, r: string): Unit => ({
  rows: 1,
  el: <Text color={color} wrap="truncate-end">{`${l}${'─'.repeat(Math.max(0, width - 2))}${r}`}</Text>,
})
const cardRow = ({ ui: { Box, Text } }: Ctx, color: Look['color'], u: Unit): Unit => ({
  rows: u.rows,
  focus: u.focus,
  el: (
    <Box>
      <Box width={1} flexShrink={0}><Text color={color}>{col('│', u.rows)}</Text></Box>
      <Box flexGrow={1} minWidth={0} paddingX={1}>{u.el}</Box>
      <Box width={1} flexShrink={0}><Text color={color}>{col('│', u.rows)}</Text></Box>
    </Box>
  ),
})
const card = (ctx: Ctx, n: StepNode): Unit[] => {
  const color = look(n).color

  return [
    edge(ctx, color, '╭', '╮'),
    ...[rowButton(ctx, n, ctx.width - 4, glyphLead(n)), ...fieldUnits(ctx, n, ctx.width - 4)].map(u => cardRow(ctx, color, u)),
    edge(ctx, color, '╰', '╯'),
  ]
}

const theme1 = (ctx: Ctx): Unit[] => {
  const { Box, Text } = ctx.ui
  if (ctx.pinned) {
    // Its own width: the window wraps every unit in a row Box, which would shrink the centering box to the arrow.
    const arrow: Unit = {
      rows: 1,
      el: <Box width={ctx.width} justifyContent="center"><Text color="inactive">↓</Text></Box>,
    }

    return ctx.list.flatMap((n, i) => [...(i > 0 ? [arrow] : []), ...card(ctx, n)])
  }

  return whole(
    <Box flexDirection="column">
      {ctx.list.map((n, i) => (
        <Box flexDirection="column">
          {i > 0 && (
            <Box justifyContent="center">
              <Text color="inactive">↓</Text>
            </Box>
          )}
          <Box flexDirection="column" borderStyle="round" borderColor={look(n).color} paddingX={1}>
            {rowButton(ctx, n, ctx.width - 4, glyphLead(n)).el}
            {fields(ctx, n)}
          </Box>
        </Box>
      ))}
    </Box>,
  )
}

const theme2 = (ctx: Ctx): Unit[] => {
  const { Box, Text } = ctx.ui
  const dot = (n: StepNode) => (isFailure(n) ? '○' : isOpen(n) ? '◆' : '●')
  if (ctx.pinned) {
    return ctx.list.flatMap((n, i) => {
      const last = i === ctx.list.length - 1
      // Under the dot the rail runs on through the step's rows (fields, spacing) to the next dot.
      const side = (u: Unit): Unit => ({
        rows: u.rows,
        el: (
          <Box columnGap={1}>
            <Box flexShrink={0} width={1}>{!last && <Text color="subtle">{col('│', u.rows)}</Text>}</Box>
            <Box flexGrow={1} minWidth={0} paddingLeft={2}>{u.el}</Box>
          </Box>
        ),
      })
      const first = rowButton(ctx, n, ctx.width, glyphLead(n, dot(n)))

      return [first, ...fieldUnits(ctx, n, ctx.width - 4).map(side), ...(hasFields(n) && !last ? [side(gapUnit(ctx))] : [])]
    })
  }

  return whole(
    <Box flexDirection="column">
      {ctx.list.map((n, i) => {
        const s = look(n)
        const last = i === ctx.list.length - 1

        return (
          <Box columnGap={1}>
            <Box flexDirection="column" flexShrink={0} width={1}>
              <Text color={s.color}>{dot(n)}</Text>
              {!last && (
                // The rail starts under the dot and runs into the next row, where the next dot covers its end.
                <Box position="absolute" top={1} bottom={-1} width={1} overflow="hidden">
                  <Text color="subtle">{'│\n'.repeat(40)}</Text>
                </Box>
              )}
            </Box>
            <Box flexDirection="column" flexGrow={1} minWidth={0} paddingBottom={last || !hasFields(n) ? 0 : 1}>
              {rowButton(ctx, n, ctx.width - 2, [[n.at, 'inactive'], ' ']).el}
              {hasFields(n) && (
                <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>,
  )
}

// Block widths for the proportion bar: every present result gets at least one cell.

const split = (counts: number[], width: number) => {
  const total = counts.reduce((a, b) => a + b, 0)
  const out = counts.map(c => (c ? Math.max(1, Math.floor((c * width) / total)) : 0))
  const biggest = out.indexOf(Math.max(...out))
  out[biggest] = (out[biggest] ?? 0) + width - out.reduce((a, b) => a + b, 0)

  return out
}

const theme3 = (ctx: Ctx): Unit[] => {
  const { Box } = ctx.ui
  const colors = ['success', 'warning', 'error', 'inactive'] as const
  const widths = split(colors.map(c => ctx.all.filter(n => barColor(n) === c).length), ctx.width)
  const bar: Unit = {
    rows: 2,
    el: (
      <Box height={1} marginTop={1}>
        {colors.map((color, i) =>
          widths[i] ? <Box width={widths[i]} height={1} backgroundColor={color} /> : null,
        )}
      </Box>
    ),
  }
  if (ctx.pinned) {
    return [...ctx.list.flatMap(n => (hasFields(n) ? card(ctx, n) : [rowButton(ctx, n, ctx.width, glyphLead(n))])), bar]
  }

  return [
    {
      rows: 1,
      el: (
        <Box flexDirection="column">
          {ctx.list.map(n =>
            !hasFields(n) ? (
              rowButton(ctx, n, ctx.width, glyphLead(n)).el
            ) : (
              <Box flexDirection="column" borderStyle="round" borderColor={look(n).color} paddingX={1}>
                {rowButton(ctx, n, ctx.width - 4, glyphLead(n)).el}
                {fields(ctx, n)}
              </Box>
            ),
          )}
          {bar.el}
        </Box>
      ),
    },
  ]
}

const theme4 = (ctx: Ctx): Unit[] => {
  const { Box, Text } = ctx.ui
  // Cells are 3 wide with a 1 cell gap; the row wraps, then a blank row.
  const perLine = Math.max(1, Math.floor((ctx.width + 1) / 4))
  const cellRow: Unit = {
    rows: Math.ceil(ctx.all.length / perLine) + 1,
    el: (
      <Box flexWrap="wrap" columnGap={1} marginBottom={1}>
        {ctx.all.map(n => (
          <Box width={3} justifyContent="center" backgroundColor={barColor(n)}>
            <Text color="inverseText" weight="bold">{look(n).glyph}</Text>
          </Box>
        ))}
      </Box>
    ),
  }
  if (ctx.pinned) {
    return [
      cellRow,
      ...ctx.list.flatMap((n, i) => {
        const indent = (u: Unit): Unit => ({ rows: u.rows, el: <Box paddingLeft={2}>{u.el}</Box> })

        return [
          rowButton(ctx, n, ctx.width, glyphLead(n)),
          ...fieldUnits(ctx, n, ctx.width - 2).map(indent),
          ...(hasFields(n) && i < ctx.list.length - 1 ? [gapUnit(ctx)] : []),
        ]
      }),
    ]
  }

  return [
    {
      rows: 1,
      el: (
        <Box flexDirection="column">
          {cellRow.el}
          {ctx.list.map((n, i) => (
            <Box flexDirection="column" paddingBottom={!hasFields(n) || i === ctx.list.length - 1 ? 0 : 1}>
              {rowButton(ctx, n, ctx.width, glyphLead(n)).el}
              {hasFields(n) && (
                <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
              )}
            </Box>
          ))}
        </Box>
      ),
    },
  ]
}

const theme5 = (ctx: Ctx): Unit[] => {
  const { Box, Text } = ctx.ui
  const { list } = ctx
  const branchOf = (i: number) => (list.length === 1 ? '──' : i === list.length - 1 ? '╰─' : i === 0 ? '╭─' : '├─')
  if (ctx.pinned) {
    return list.flatMap((n, i) => {
      const last = i === list.length - 1
      const s = look(n)
      const row = (left: El, u: Unit): Unit => ({
        rows: u.rows,
        el: (
          <Box columnGap={1}>
            <Box width={9} flexShrink={0}>{left}</Box>
            <Box flexGrow={1} minWidth={0}>{u.el}</Box>
          </Box>
        ),
      })
      // The branch line continues under the `├` through the step's rows.
      const rail = (u: Unit) =>
        row(
          last ? <Box /> : (
            <Box marginLeft={7} width={1}><Text color="subtle">{col('│', u.rows)}</Text></Box>
          ),
          { rows: u.rows, el: <Box paddingLeft={2}>{u.el}</Box> },
        )
      const first = rowButton(ctx, n, ctx.width, [[`${n.at}  ${branchOf(i)}`, 'inactive', true], ' ', [s.glyph, s.color], ' '])

      return [first, ...fieldUnits(ctx, n, ctx.width - 12).map(rail), ...(hasFields(n) && !last ? [rail(gapUnit(ctx))] : [])]
    })
  }

  return whole(
    <Box flexDirection="column">
      {list.map((n, i) => {
        const s = look(n)
        const has = hasFields(n)
        const last = i === list.length - 1

        return (
          <Box columnGap={1}>
            <Box flexDirection="column" flexShrink={0} width={9}>
              <Text color="inactive" mono>{n.at}  {branchOf(i)}</Text>
              {has && !last && (
                <Box marginLeft={7} width={1} flexGrow={1} overflow="hidden">
                  {/* Clip to the border's left edge, as tall as the wrapped details. */}
                  <Box position="absolute" top={-1} bottom={-1} width={3} borderStyle="single" borderColor="subtle" />
                </Box>
              )}
            </Box>
            <Box flexDirection="column" flexGrow={1} minWidth={0} paddingBottom={has && !last ? 1 : 0}>
              {rowButton(ctx, n, ctx.width - 10, [[s.glyph, s.color], ' ']).el}
              {has && (
                <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>,
  )
}

const theme7 = (ctx: Ctx): Unit[] => {
  const { Box, Text } = ctx.ui
  const { t } = ctx
  const col1 = { width: 7, flexShrink: 0 } as const
  const labelCells = Math.max(cells(t.ok), cells(t.blocked), cells(t.deferred), cells(t.chosen), cells(t.needsDecision), cells(t.decided), cells(t.result))
  const col3 = { width: Math.max(9, labelCells + 1), flexShrink: 0 } as const
  const header = (
    <Box>
      <Box {...col1}><Text color="inactive">{t.time}</Text></Box>
      <Box flexGrow={1} minWidth={0}><Text color="inactive">{t.step}</Text></Box>
      <Box {...col3}><Text color="inactive">{t.result}</Text></Box>
    </Box>
  )
  const rule = <Text color="subtle" wrap="truncate-end">{'─'.repeat(ctx.width)}</Text>
  const mid = Math.max(1, ctx.width - 7 - col3.width)
  // The title lines as one Button over all three columns: time, title, result.
  const titleRow = (n: StepNode) =>
    lineButton(
      ctx,
      n,
      wrapLines(oneLine(n.title), mid).map((line, i): Part[] => [
        ...(i === 0 ? [<Text color="inactive">{n.at}</Text>, spaces(col1.width - cells(n.at))] : [spaces(col1.width)]),
        titleText(ctx, n, line),
        spaces(mid - cells(line)),
        i === 0 ? <Text color={tagColor(n)} weight="bold">{padCells(label(t, n), col3.width)}</Text> : spaces(col3.width),
      ]),
    )
  if (ctx.pinned) {
    return [
      { rows: 1, el: header, pin: true },
      { rows: 1, el: rule, pin: true },
      ...ctx.list.flatMap((n, i) => {
        const row = (u: Unit): Unit => ({
          rows: u.rows,
          el: (
            <Box>
              <Box {...col1} />
              <Box flexDirection="column" flexGrow={1} minWidth={0}>{u.el}</Box>
              <Box {...col3} />
            </Box>
          ),
        })

        return [titleRow(n), ...fieldUnits(ctx, n, mid).map(row), ...(hasFields(n) && i < ctx.list.length - 1 ? [gapUnit(ctx)] : [])]
      }),
    ]
  }

  return whole(
    <Box flexDirection="column">
      {header}
      {rule}
      {ctx.list.map((n, i) => (
        <Box flexDirection="column" paddingBottom={!hasFields(n) || i === ctx.list.length - 1 ? 0 : 1}>
          {titleRow(n).el}
          {hasFields(n) && (
            <Box>
              <Box {...col1} />
              <Box flexDirection="column" flexGrow={1} minWidth={0}>{fields(ctx, n)}</Box>
              <Box {...col3} />
            </Box>
          )}
        </Box>
      ))}
    </Box>,
  )
}

export const UNITS: Record<number, (ctx: Ctx) => Unit[]> = {
  1: theme1,
  2: theme2,
  3: theme3,
  4: theme4,
  5: theme5,
  7: theme7,
}
