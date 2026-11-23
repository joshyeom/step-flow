import { atom, read, update } from 'claude-code'
import type { Elements, Register } from 'claude-code'

import type { BtwEntry, StepAttempt, StepNode, StepOption, StepStatus, ViewWindow } from '../types'
import { type Strings, toLocale, tr } from './i18n'
import {
  type Ctx,
  cut,
  detail,
  hhmm,
  isFailure,
  isKept,
  isOpen,
  letter,
  norm,
  STATUS,
  THEME_IDS,
  type Unit,
  UNITS,
  word,
  wrapRows,
} from './themes'

const PANE = 'step-flow'
const TOOL = 'mcp__step-flow__step'
const TOOL_DECIDED = 'mcp__step-flow__decided'
const TOOL_RESOLVE = 'mcp__step-flow__resolve'
const nodes = atom({ plugin: 'step-flow', key: 'nodes' } as const, [], {
  shape: 'nodes-2',
})
const theme = atom({ plugin: 'step-flow', key: 'theme' } as const, 7)
const selected = atom({ plugin: 'step-flow', key: 'selected' } as const, '')
const btw = atom({ plugin: 'step-flow', key: 'btw' } as const, [])
// Bumped on every btw submit: a new Input key draws a fresh, empty field.
const btwInput = atom({ plugin: 'step-flow', key: 'btwInput' } as const, 0)
// Background of the question row, picked from the `theme` setting at session start.
const rowBg = atom({ plugin: 'step-flow', key: 'rowBg' } as const, '#3a3a3a')
// True while the theme picker is drawn in the pane's bottom block.
const themePicker = atom({ plugin: 'step-flow', key: 'themePicker' } as const, false)
// Decision nodes whose pane choice is on its way to the model (guards a double press).
const deciding = atom({ plugin: 'step-flow', key: 'deciding' } as const, [])
// Docked pane: the window over the list view and over the detail view, and whether each keeps to its end.
const listView = atom({ plugin: 'step-flow', key: 'listView' } as const, { offset: 0, follow: true })
const detailView = atom({ plugin: 'step-flow', key: 'detailView' } as const, { offset: 0, follow: false })

const DESCRIPTION =
  "Record one finished unit of work as a node in the step-flow side pane. The user reads this pane when they come back to see what happened while they were away, so call it once each time a meaningful step ends (a stage of the task, not every tool call), in order. status: 'done' = it worked the first time; 'resolved' = it failed, then you fixed it in the same step; 'deferred' = it failed, is not fixed, and does NOT block the goal or the remaining work; 'blocked' = it failed, is not fixed, and blocks the goal or the work that depends on it; 'decision' = a choice only the user should make (an approach, a trade-off, anything you should not decide alone). If you got past a problem another way, that is 'resolved' with fix = the other way; if you could not get past it, it is 'deferred' or 'blocked': ask whether it blocks the goal or the remaining work. cause = the problem and why it happened (required unless done); for blocked also what it would take to get past it (what the user must do), in one or two sentences; for decision, what must be decided and why. attempts = each thing you tried, every one WITH the reason you tried it ({ action, reason }); required for resolved, optional for deferred and blocked. fix = what finally made it pass (required for resolved; not allowed for deferred and blocked: when you fix one later, call mcp__step-flow__resolve with its id and the fix). okReason = required for deferred: why moving on is safe, what does not depend on it, when you will come back. notDone = required for blocked: each piece of work you could not do because of it, one short item each. On blocked, stop the work that depends on it and continue only independent work; if nothing independent is left, end the turn and say what is needed. For deferred and blocked give options (at least 2, each { option, note }) whenever there is more than one way to continue, for example { option: 'Retry after X', note: 'the user provides X, then retry' } and { option: 'Skip it', note: 'continue without it' }; the user picks in the pane. Do not put A/B letters or numbers in option: the pane adds them. For decision give options (at least 2, each { option, note }: a short label, and what choosing it means or its trade-off) and interim (what you do meanwhile) instead of attempts and fix. Whenever the user must choose, record a decision step, then keep working on what does not depend on it; do this also before you end a turn with a question to the user. The user chooses by pressing a button in the pane, which sends a prompt from the step-flow plugin starting with \"결정 (\", \"Decision (\", \"진행 (\" or \"Go ahead (\": that is the user's own choice and is already recorded, so continue with it without asking again and without calling mcp__step-flow__decided; but a choice on an old step may be stale, so check that it still applies to the current state before you change anything, and never undo later work without asking the user first; if you refuse a pane choice, reopen it by calling mcp__step-flow__decided with that step's id and choice 0, then tell the user. Before you tell the user the task is finished, or end a long run, name every open item in your message: decisions still pending, choices still open on failures, and blocked steps with the work each one held up. detail = longer notes shown when the user opens the step: give a fuller detail on every non-trivial step (what you checked, files, commands, numbers). A call missing a required field is denied with the field names: call again with them. Keep title under 40 characters. Write title, cause, attempts, fix, okReason, notDone, options, interim and detail in the language the user writes in."

const REMINDER =
  "A step-flow side pane shows the user what happened while they were away. Each time a meaningful step of a task ends, call mcp__step-flow__step, as it finishes and not all at the end. status: 'done' = it worked the first time; 'resolved' = it failed, then you fixed it in the same step; 'deferred' = it failed, is not fixed, and does not block the goal or the remaining work (give okReason: why moving on is safe); 'blocked' = it failed, is not fixed, and blocks the goal or the work that depends on it (give notDone: each piece of work you could not do because of it, one short item each, and say in cause what it would take to get past it); 'decision' = a choice only the user should make. Got past a problem another way = resolved with fix = the other way; could not get past it = deferred or blocked. For anything but done give cause (the problem and why). For resolved also give attempts (each thing you tried WITH the reason you tried it) and fix. When you fix a deferred or blocked step later, call mcp__step-flow__resolve with its id and the fix. On blocked, stop the work that depends on it and continue only independent work; if nothing independent is left, end the turn and say what is needed; give options (at least 2 of { option, note }, no A/B letters or numbers in option: the pane adds them) on deferred or blocked whenever there is more than one way to continue. Whenever the user must choose (an approach, a trade-off, anything you should not decide alone), record a decision step (cause = what must be decided and why, options = at least 2 of { option, note }, interim = what you do meanwhile), then keep working on what does not depend on it; do this also before you end a turn with a question to the user. The user chooses by pressing a button in the pane, which sends a prompt from the step-flow plugin starting with \"결정 (\", \"Decision (\", \"진행 (\" or \"Go ahead (\": that is the user's own choice and is already recorded, so continue with it without asking again and without calling mcp__step-flow__decided; but a choice on an old step may be stale, so check that it still applies to the current state before you change anything, and never undo later work without asking the user first; if you refuse a pane choice, reopen it by calling mcp__step-flow__decided with that step's id and choice 0, then tell the user. If the user answers in chat instead, call mcp__step-flow__decided with the step id and the chosen option number. Before you tell the user the task is finished, or end a long run, name every open item in your message: decisions still pending, choices still open on failures, and blocked steps with the work each one held up. detail is longer notes (what you checked, numbers, file paths, commands) the user sees when they open the step: give a fuller detail on every non-trivial step. Keep title under 40 characters and write in the user's language."

const MAX = 200
const BTW_KEEP = 50
const BTW_RULES =
  "You answer a side question about an ongoing Claude Code session. Use only the transcript and work log given; if the answer is not there, say you don't know. You cannot run tools or change anything. Answer briefly, in the language of the question. The answer is rendered as markdown in a narrow side pane, so keep it short and use at most simple bullet lists and bold, no headings or tables."
const DEFAULT_THEME = 7
// Of the 100,000 serialized characters a render tree may hold, what the list view may spend.
const TREE_BUDGET = 90000

// An option label without a leading `A:` / `A.` / `A)` / `1.` the model may add: the pane draws the letter.
const bare = (label: string) => {
  const rest = label.replace(/^(?:[A-Z]|\d{1,2})\s*[:.)]\s*/, '')

  return rest || label
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const asTheme = (v: unknown) =>
  typeof v === 'number' && THEME_IDS.includes(v) ? v : DEFAULT_THEME

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)
const jsonText = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}
const resultText = (c: unknown): string => {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''

  return c
    .map(x => (typeof x === 'string' ? x : x?.type === 'text' && typeof x.text === 'string' ? x.text : ''))
    .filter(Boolean)
    .join('\n')
}
// One content block as text; images, documents and thinking give ''.
const blockText = (b: Record<string, unknown>) => {
  if (b.type === 'text') return typeof b.text === 'string' ? b.text : ''
  if (b.type === 'tool_use') return `[tool ${String(b.name)}] ${clip(jsonText(b.input), 2000)}`
  if (b.type === 'tool_result') return `[result] ${clip(resultText(b.content), 4000)}`

  return ''
}
const flatten = (msgs: unknown[]) =>
  msgs
    .map(m => {
      const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown }
      const blocks = (Array.isArray(content) ? content : []) as Record<string, unknown>[]

      return `${String(role)}:\n${blocks.map(b => blockText(b ?? {})).filter(Boolean).join('\n')}`
    })
    .join('\n\n')

const nodeLog = (n: StepNode, t: Strings) => {
  const lines = [`[${n.at}] ${n.title} (${word(t, n)})`]
  const optionLines = () => n.options?.forEach((o, i) => lines.push(`${letter(i)}. ${o.option}: ${o.note}`))
  const picked = (p: NonNullable<StepNode['chosen']>, label: string) => {
    const pick = n.options?.[p.choice]
    if (pick) lines.push(`${label}: ${letter(p.choice)} (${pick.option}) ${hhmm(p.ts)}`)
  }
  if (n.status === 'decision') {
    lines.push(`${t.issue}: ${n.cause ?? ''}`)
    optionLines()
    if (n.interim) lines.push(`${t.meanwhile}: ${n.interim}`)
    if (n.decided) picked(n.decided, t.decisionRow)
  } else {
    if (n.cause) lines.push(`${isFailure(n) ? t.cause : t.problem}: ${n.cause}`)
    if (n.status === 'deferred') lines.push(`${t.okReason}: ${n.okReason || '—'}`)
    if (n.notDone?.length) lines.push(`${t.notDone}:`, ...n.notDone.map(item => `- ${item}`))
    n.attempts?.forEach((a, i) => lines.push(`${t.attempt(i + 1)}: ${a.action} (${t.reason(a.reason)})`))
    optionLines()
    if (n.chosen) picked(n.chosen, t.chosen)
    if (n.fix) lines.push(`${t.fix}: ${n.fix}`)
    if (n.resolvedAt) lines.push(`${t.resolvedRow}: ${hhmm(n.resolvedAt)}`)
  }
  if (n.detail) lines.push(`${t.detail}: ${n.detail}`)

  return lines.join('\n')
}

let btwSeq = 0
// The pane's size as last drawn when it is docked (rows 0 otherwise). Drawing is pure, so it is no state: the
// render hook leaves it here for the ui.scroll hook, which only needs it between two draws of the same module.
let dock = { cols: 0, rows: 0 }

// Summary: step count, open choices (decisions and failures with options), blocked and deferred steps
// without options (open until `resolve`); a failure with options is counted once, under the choices.
const pendingCount = (list: StepNode[]) => list.filter(isOpen).length
const blockedCount = (list: StepNode[]) => list.filter(n => n.status === 'blocked' && !n.options?.length).length
const deferredCount = (list: StepNode[]) => list.filter(n => n.status === 'deferred' && !n.options?.length).length

const summaryText = (list: StepNode[], t: Strings) =>
  `${t.steps(list.length)}, ${t.toDecide(pendingCount(list))}, ${t.blockedN(blockedCount(list))}, ${t.deferredN(deferredCount(list))}`

// Rough serialized size of a node in the list views (texts cut as they are drawn). The title lines are padded
// with spaces to the pane width, about two characters per column in the tree.
const weight = (n: StepNode, cols: number) =>
  800 +
  n.title.length +
  2 * cols * wrapRows(n.title, cols - 12) +
  (n.status === 'done' || n.status === 'decision'
    ? 0
    : [n.cause, n.fix, n.okReason, ...(n.notDone ?? []), ...(n.attempts ?? []).flatMap(a => [a.action, a.reason])].reduce<number>(
        (w, x) => w + 300 + cut(x ?? '').length, // blank line + row
        0,
      ))

// Nodes the list views draw, under the tree limit: oldest done nodes go first, then the oldest of
// the rest; the newest node, open choices and unresolved failures (their ids serve `resolve`) always stay.
const visible = (list: StepNode[], cols: number) => {
  let total = list.reduce((w, n) => w + weight(n, cols), 0)
  const newest = list[list.length - 1]
  const skip = new Set<string>()
  for (const n of [...list.filter(x => x.status === 'done'), ...list.filter(x => x.status !== 'done')]) {
    if (total <= TREE_BUDGET) break
    if (n === newest || isKept(n)) continue
    skip.add(n.id)
    total -= weight(n, cols)
  }

  return { shown: list.filter(n => !skip.has(n.id)), hidden: skip.size }
}

// What the pane draws from, as read from state; the render and ui.scroll hooks build the same layout from it.
type FullUi = Elements['terminal']
type View = {
  ui: FullUi
  t: Strings
  list: StepNode[]
  themeId: number
  selectedId: string
  btwList: BtwEntry[]
  pickerOpen: boolean
  bg: string
  cols: number
  // Rows of the pane body when docked, 0 when it scrolls as one body.
  rows: number
  select: (id: string) => unknown
  decide: (n: StepNode, i: number) => unknown
  back: () => unknown
  // The ✕ on the question row: closes the exchange.
  close: () => unknown
}

const selectedNode = (v: View) => v.list.find(n => n.id === v.selectedId)
// List view: the latest exchange overall; detail view: the latest one asked on that node.
// A closed exchange is not shown, and no older one takes its place (closing closes them all).
const lastExchange = (v: View) => {
  const node = selectedNode(v)
  const last = node ? v.btwList.findLast(x => x.nodeId === node.id) : v.btwList[v.btwList.length - 1]

  return last?.closed ? undefined : last
}
const blank = ({ Box }: FullUi): Unit => ({ rows: 1, el: <Box height={1} /> })

// The current view as units: back + detail, the empty text, or the hidden note + the theme's rows.
const viewUnits = (v: View): Unit[] => {
  const { ui, t, list, cols } = v
  const { Box, Text, Button } = ui
  const { shown, hidden } = visible(list, cols)
  const ctx: Ctx = { ui, list: shown, all: list, width: cols, t, select: v.select, decide: v.decide, pinned: v.rows > 0 }
  const node = selectedNode(v)
  if (node) {
    const start = list[list.indexOf(node) - 1]?.ts ?? node.ts
    const minutes = Math.floor((node.ts - start) / 60000)
    const span = `${hhmm(start)} ~ ${hhmm(node.ts)} (${minutes < 1 ? t.lessThanMinute : t.minutes(minutes)})`

    return [
      { rows: 1, el: <Box><Button key="back" onPress={v.back}>{t.back}</Button></Box>, pin: true },
      blank(ui),
      ...detail(ctx, node, span, list.length - 1 - list.indexOf(node)),
    ]
  }
  if (list.length === 0) return [{ rows: wrapRows(t.empty, cols), el: <Text dimColor>{t.empty}</Text> }]
  const note = t.hidden(hidden)

  return [
    ...(hidden > 0 ? [{ rows: wrapRows(note, cols), el: <Text dimColor>{note}</Text> }] : []),
    ...(UNITS[v.themeId]?.(ctx) ?? []),
  ]
}

// The answer as blocks: blank-line separated paragraphs, and each top-level list item with its sub-items.
// `gap`: a blank line stood before the block. Code fences are never cut.
const mdBlocks = (src: string) => {
  const out: { text: string; gap: boolean }[] = []
  let cur: string[] = []
  let fence = false
  let gap = false
  const flush = () => {
    if (!cur.length) return
    out.push({ text: cur.join('\n'), gap })
    cur = []
    gap = false
  }
  for (const line of src.split('\n')) {
    const isFence = /^\s*(```|~~~)/.test(line)
    if (!fence && !isFence && line.trim() === '') {
      flush()
      gap = out.length > 0
      continue
    }
    if (!fence && !isFence && /^([-*+]|\d+[.)])\s/.test(line)) flush()
    cur.push(line)
    if (isFence) fence = !fence
  }
  flush()

  return out
}
// Rows of a markdown block at `width`: list lines lose the marker's and the nesting's indent.
const mdRows = (block: string, width: number) =>
  block.split('\n').reduce((n, line) => {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    const indent = m ? (m[1]?.length ?? 0) + (m[2]?.length ?? 0) + 1 : (/^\s*/.exec(line)?.[0].length ?? 0)
    const plain = (m ? (m[3] ?? '') : line.trimStart()).replace(/\*\*|__|`/g, '')

    return n + wrapRows(plain, Math.max(1, width - indent))
  }, 0)

// Cells kept free on the question row for a scroll marker (`↓ 9999`) and the cell between it and the ✕.
const MARKER_ROOM = 7

// The latest question and its answer: elements, and the answer as units for the docked window.
const exchange = (v: View, last: BtwEntry) => {
  const { Box, Text, Markdown, Button } = v.ui
  const { t } = v
  const text = Math.max(1, v.cols - 2)
  // The question text gives way to the ✕: a cell of gap, the button, a cell of padding before the edge.
  // Docked, a `↑ N` / `↓ N` marker may sit on this row, left of the ✕: keep room for it so the text never runs under.
  const markerRoom = v.rows > 0 ? MARKER_ROOM : 0
  const questionText = Math.max(1, text - 3 - markerRoom)
  // Same look as the transcript: a mark column of 2 cells, then the text with a hanging indent.
  const row = (mark: ReturnType<typeof Text>, body: ReturnType<typeof Text>) => (
    <Box>
      <Box width={2} flexShrink={0}>{mark}</Box>
      <Box flexDirection="column" flexGrow={1} minWidth={0}>{body}</Box>
    </Box>
  )
  const q = last.q.replace(/\s+/g, ' ')
  let answer
  let answerUnits: Unit[]
  if (last.pending) {
    answer = row(<Text color="claude">{'✻ '}</Text>, <Text dimColor>{t.btwPending}</Text>)
    answerUnits = [{ rows: 1, el: answer }]
  } else if (last.error !== undefined) {
    answer = row(<Text color="error">{'⏺ '}</Text>, <Text color="error" wrap="wrap">{t.btwFailed(last.error)}</Text>)
    answerUnits = [{ rows: wrapRows(t.btwFailed(last.error), text), el: answer }]
  } else {
    answer = row(<Text>{'⏺ '}</Text>, <Markdown text={last.a ?? ''} />)
    const blocks = mdBlocks(last.a ?? '')
    answerUnits = blocks.length
      ? blocks.flatMap((b, i) => [
          ...(b.gap ? [blank(v.ui)] : []),
          { rows: mdRows(b.text, text), el: row(<Text>{i === 0 ? '⏺ ' : '  '}</Text>, <Markdown text={b.text} />) },
        ])
      : [{ rows: 1, el: answer }]
  }

  return {
    question: (
      <Box backgroundColor={v.bg} width={v.cols}>
        <Box flexGrow={1} minWidth={0} paddingRight={markerRoom}>
          {row(<Text color="#949494">{'❯ '}</Text>, <Text wrap="wrap">{q}</Text>)}
        </Box>
        <Box flexShrink={0} marginX={1}>
          <Button plain key="btw-close" onPress={v.close}>✕</Button>
        </Box>
      </Box>
    ),
    questionRows: wrapRows(q, questionText),
    answer,
    answerUnits,
  }
}

// A double rule across the pane, unlike the single rules elsewhere in it: the very top or bottom of the content.
const cap = (v: View): Unit => ({
  rows: 1,
  el: <v.ui.Text color="subtle" wrap="truncate-end">{'═'.repeat(Math.max(1, v.cols))}</v.ui.Text>,
})

// Docked pane: the body is `rows` tall, a window over the content on top and the footer under it.
// Row heights are estimates (wrapRows for texts, one per list row); the window cuts between units.
const PICKER_ROWS = 1 + THEME_IDS.length + 1 // title, the options, the close button
const layoutOf = (v: View) => {
  const last = lastExchange(v)
  const qa = last && exchange(v, last)
  const question: Unit | undefined = qa && { rows: qa.questionRows, el: qa.question }
  const all: Unit[] = [...viewUnits(v), ...(qa && question ? [blank(v.ui), question, blank(v.ui), ...qa.answerUnits] : [])]
  // Pinned units stay above the window; the rest scrolls.
  const fixed = all.filter(u => u.pin)
  const body = all.filter(u => !u.pin)
  const pinnedRows = fixed.reduce((n, u) => n + u.rows, 0)
  const summaryRows = wrapRows(summaryText(v.list, v.t), v.cols - 2)
  // summary, picker, rule and the one row of the question input
  const footerRows = summaryRows + (v.pickerOpen ? PICKER_ROWS : 0) + 2
  const regionRows = Math.max(1, v.rows - footerRows - pinnedRows)
  // When the content does not fit, a double rule scrolls in first and last, so the very top and the very
  // bottom can be seen. Fit is measured without them, so adding them cannot flip the answer.
  const overflow = body.reduce((n, u) => n + u.rows, 0) > regionRows
  const units = overflow ? [cap(v), ...body, cap(v)] : body
  const starts: number[] = []
  let total = 0
  for (const u of units) {
    starts.push(total)
    total += u.rows
  }
  const snapUp = (off: number) => starts.find(x => x >= off) ?? starts[starts.length - 1] ?? 0
  const snapDown = (off: number) => starts.findLast(x => x <= off) ?? 0
  const max = Math.max(0, total - regionRows)
  const end = snapUp(max)
  const qi = question ? units.indexOf(question) : -1
  const questionStart = qi >= 0 ? starts[qi] : undefined

  return { fixed, units, starts, total, pinnedRows, summaryRows, footerRows, regionRows, end, snapUp, snapDown, max, questionStart }
}

// Where the window starts: a fresh question at the top when its exchange is taller than the window, the end
// while it follows, else the stored row kept inside the content.
const windowStart = (w: ViewWindow, l: ReturnType<typeof layoutOf>) => {
  if (w.ask && l.questionStart !== undefined) return l.total - l.questionStart > l.regionRows ? l.questionStart : l.end
  if (w.follow) return l.end

  return l.snapUp(Math.min(Math.max(w.offset, 0), l.max))
}

// The view as read from state, for hooks that only need its layout (the callbacks do nothing).
const viewOf = async ($: any, d: typeof dock): Promise<View> => {
  const selectedId = await read($, selected)
  const list = (await read($, nodes)).map(norm)

  return {
    ui: $.ui.resolve({ surface: 'terminal', component: 'Pane' }),
    t: tr(await localeOf($)),
    list,
    themeId: asTheme(await read($, theme)),
    selectedId,
    btwList: await read($, btw),
    pickerOpen: await read($, themePicker),
    bg: await read($, rowBg),
    cols: d.cols,
    rows: d.rows,
    select: () => {},
    decide: () => {},
    back: () => {},
    close: () => {},
  }
}

// Docked: moves the window so the row holding `key` shows with its neighbouring focusable rows, or alone when
// they do not all fit. 'shown' when they already did, 'moved' when the window moved, false when the pane is not
// docked or has no such row.
const reveal = async ($: any, key: string) => {
  const d = dock
  if (d.rows <= 0) return false
  const v = await viewOf($, d)
  const l = layoutOf(v)
  const at = l.units.findIndex(u => u.focus?.includes(key))
  if (at < 0) return false
  const stops = l.units.flatMap((u, i) => (u.focus ? [i] : []))
  const k = stops.indexOf(at)
  const end = (i: number) => (l.starts[i] ?? 0) + (l.units[i]?.rows ?? 0)
  let top = l.starts[stops[k - 1] ?? at] ?? 0
  let bottom = end(stops[k + 1] ?? at)
  if (bottom - top > l.regionRows) {
    top = l.starts[at] ?? 0
    bottom = end(at)
  }
  const detailOpen = v.list.some(n => n.id === v.selectedId)
  const from = windowStart(detailOpen ? await read($, detailView) : await read($, listView), l)
  if (top >= from && bottom <= from + l.regionRows) return 'shown'
  // A row taller than the window stops at its own start, not at the next row's.
  const offset = Math.min(Math.max(top < from ? l.snapDown(top) : Math.min(l.snapUp(bottom - l.regionRows), top), 0), l.end)
  const moved = { offset, follow: offset >= l.end }
  if (detailOpen) await update($, detailView, () => moved)
  else await update($, listView, () => moved)

  return 'moved'
}

// The engine keeps the focus ring by position among the drawn buttons, so after the window moved the ring is put back
// on its key once the redraw is done. Any other focus move in between cancels it (a held key is not pulled back).
let focusSeq = 0
const focusSoon = ($: any, key: string) => {
  const seq = ++focusSeq
  $.clock.after(80, () => {
    if (seq === focusSeq) void $.ui.focus({ requestId: PANE, key }).catch(() => {})
  })
}

// The language, resolved on first use (session.start refreshes it) so a session where that hook did not run
// still shows the user's language.
let cachedLocale: string | undefined
const localeOf = async ($: any, fresh = false) => {
  if (fresh || !cachedLocale)
    cachedLocale = toLocale(
      str(await $.settings.read({ key: 'language' })) ||
        (await $.env.get('LANG')) ||
        (await $.env.get('LC_ALL')),
    )

  return cachedLocale
}

// Turn on the fullscreen layout, where the pane docks on the right, unless the user's own settings
// already name a `tui` value or cannot be parsed. Takes effect from the next session.
const fullscreenByDefault = async ($: any, t: Strings) => {
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const path = `${home}/.claude/settings.json`
    const obj = (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {}
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj) || 'tui' in obj) return
    await $.fs.write(path, JSON.stringify({ ...obj, tui: 'fullscreen' }, null, 2) + '\n')
    $.ui.toast(t.fullscreenOn)
  } catch {
    // Never break session.start.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const loc = await localeOf($, true)
    const bg = str(await $.settings.read({ key: 'theme' })).includes('light') ? '#f0f0f0' : '#3a3a3a'
    await update($, rowBg, () => bg)
    const t = tr(loc)
    await fullscreenByDefault($, t)
    await $.tool.register({
      name: 'step',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80 },
          status: {
            type: 'string',
            enum: ['done', 'resolved', 'deferred', 'blocked', 'decision'],
          },
          cause: { type: 'string' },
          attempts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['action', 'reason'],
            },
          },
          fix: { type: 'string' },
          detail: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                option: { type: 'string' },
                note: { type: 'string' },
              },
              required: ['option', 'note'],
            },
          },
          interim: { type: 'string' },
          okReason: { type: 'string' },
          notDone: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'status'],
      },
    })
    await $.tool.register({
      name: 'resolve',
      description:
        "Turn a deferred or blocked step-flow step into resolved once you have fixed it: it keeps its cause and earlier attempts, takes the new attempts and the fix, and turns green in the pane. id = the step's id (the one the step call returned); it may be left out only when exactly one deferred or blocked step exists. fix = what finally fixed it. attempts = anything else you tried since, each { action, reason }.",
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fix: { type: 'string' },
          attempts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['action', 'reason'],
            },
          },
        },
        required: ['fix'],
      },
    })
    await $.tool.register({
      name: 'decided',
      description:
        "Record the user's choice on a step-flow step that has options: a pending decision, or a deferred or blocked step with options. Call it when the user answered in chat instead of the pane. id = the step's id (the one the step call returned); it may be left out only when exactly one choice is open (decisions and failures with options and no choice yet, counted together); with more than one, give the id. choice = the number of the option the user chose, starting at 1. Calling it again for a step that already has a choice changes the choice. choice 0 reopens the step's choice (the pending decision or the options on a deferred or blocked step come back in the pane): use it when you refuse a choice made in the pane because it no longer applies; with choice 0 the id may be left out only when exactly one step has a choice set. A step with nothing to reopen answers 'nothing to reopen'.",
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          choice: { type: 'integer', minimum: 0 },
        },
        required: ['choice'],
      },
    })
    await $.command.register({
      name: 'flow',
      description: t.flowDesc,
      immediate: true,
    })
    await $.command.register({
      name: 'flow-clear',
      description: t.flowClearDesc,
      immediate: true,
    })
    await $.command.register({
      name: 'flow-theme',
      description: t.flowThemeDesc,
      argumentHint: '[1|2|3|4|5|7]',
      immediate: true,
    })
    const stored = asTheme(await $.store.get('theme'))
    await update($, theme, () => stored)
    void $.ui.open({ id: PANE, title: t.paneTitle })

    return next(e)
  })

  // prompt.compose is bypassed on managed machines, so the reminder rides each typed prompt as hidden context.
  on('prompt.submit', ($, e, next) => next(e.command ? e : { ...e, context: [...(e.context ?? []), REMINDER] }))

  on('command.run', { command: 'flow' }, async $ => {
    const t = tr(await localeOf($))
    await $.ui.open({ id: PANE, title: t.paneTitle })

    return { text: t.flowOpened }
  })

  on('command.run', { command: 'flow-clear' }, async $ => {
    await update($, nodes, () => [])
    await update($, selected, () => '')
    await update($, listView, () => ({ offset: 0, follow: true }))
    // An answer about cleared steps must not stay on screen.
    await update($, btw, l => l.map(x => ({ ...x, closed: true as const })))

    return { text: tr(await localeOf($)).flowCleared }
  })

  on('command.run', { command: 'flow-theme' }, async ($, e) => {
    const t = tr(await localeOf($))
    const n = Number(e.args.trim())
    if (THEME_IDS.includes(n)) {
      await $.store.set('theme', n)
      await update($, theme, () => n)
      await update($, themePicker, () => false)

      return { text: t.themeSet(n, t.themes[n] ?? '') }
    }
    await update($, themePicker, () => true)
    await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })
    $.ui.focus({ requestId: PANE, key: 'theme-picker' }).catch(() => {})
    // Docked, the picker sits in the pinned footer and needs no scroll.
    if (dock.rows === 0) {
      try {
        await $.ui.scroll({ in: PANE, to: { key: 'theme-picker' } })
      } catch {}
    }

    return { text: t.themePickerOpened }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const status = input.status as StepStatus
    if (typeof status !== 'string' || !Object.hasOwn(STATUS, status)) {
      const gone = status === ('workaround' as string) || status === ('unresolved' as string)

      return {
        deny: `status must be one of: done, resolved, deferred, blocked, decision${
          gone
            ? `. ${status} no longer exists: if you got past the problem another way, use resolved with fix = the other way; if you could not, use deferred (does not block the goal or the remaining work) or blocked (does)`
            : ''
        }`,
      }
    }
    const title = str(input.title)
    const cause = str(input.cause)
    const fix = str(input.fix)
    const detail = str(input.detail)
    const interim = str(input.interim)
    const okReason = str(input.okReason)
    const givenNotDone = Array.isArray(input.notDone) ? input.notDone : []
    const notDone = givenNotDone.map(str)
    const given = Array.isArray(input.attempts) ? input.attempts : []
    const attempts: StepAttempt[] = given.map(a => ({
      action: str((a as Record<string, unknown> | null)?.action),
      reason: str((a as Record<string, unknown> | null)?.reason),
    }))
    const givenOptions = Array.isArray(input.options) ? input.options : []
    const options: StepOption[] = givenOptions.map(o => ({
      option: bare(str((o as Record<string, unknown> | null)?.option)),
      note: str((o as Record<string, unknown> | null)?.note),
    }))
    const isDecision = status === 'decision'
    const failure = status === 'deferred' || status === 'blocked'

    if (status === 'done' && (cause || fix)) {
      return {
        deny: 'done cannot have cause or fix; if it failed first, call again with status resolved (with attempts and fix), or deferred or blocked if it is still not fixed',
      }
    }
    if ((status === 'done' || status === 'resolved') && (okReason || givenOptions.length)) {
      return { deny: `${status} cannot have okReason or options; they belong to deferred and blocked steps` }
    }
    if (status !== 'blocked' && input.notDone !== undefined && !(Array.isArray(input.notDone) && input.notDone.length === 0)) {
      return { deny: `${status} cannot have notDone; it belongs to blocked steps` }
    }
    if (failure && fix) {
      return { deny: `${status} means not fixed yet, so it cannot have a fix; call ${TOOL_RESOLVE} with this step's id when it is fixed` }
    }
    if (isDecision && (given.length || fix)) {
      return {
        deny: 'decision cannot have attempts or fix; put what must be decided in cause, the choices in options and what you do meanwhile in interim',
      }
    }
    const missing: string[] = []
    if (!title) missing.push('title')
    if (status !== 'done' && !cause) missing.push('cause')
    if (isDecision && options.length < 2) missing.push('options (at least 2)')
    if (failure && givenOptions.length > 0 && options.length < 2) missing.push('options (at least 2)')
    if (isDecision && !interim) missing.push('interim')
    if (status === 'resolved' && attempts.length === 0) missing.push('attempts (at least 1)')
    attempts.forEach((a, i) => {
      if (!a.action) missing.push(`attempts[${i + 1}].action`)
      if (!a.reason) missing.push(`attempts[${i + 1}].reason`)
    })
    if (isDecision || failure) {
      options.forEach((o, i) => {
        if (!o.option) missing.push(`options[${i + 1}].option`)
        if (!o.note) missing.push(`options[${i + 1}].note`)
      })
    }
    if (status === 'resolved' && !fix) missing.push('fix')
    if (status === 'deferred' && !okReason) missing.push('okReason (why moving on is safe)')
    if (status === 'blocked' && notDone.length === 0) {
      missing.push('notDone (at least 1 item: each piece of work you could not do because of it, one short item each)')
    }
    notDone.forEach((item, i) => {
      if (!item) missing.push(`notDone[${i + 1}] (empty)`)
    })
    if (missing.length) {
      return {
        deny: `missing: ${missing.join('; ')}. Call ${TOOL} again with these fields filled in.`,
      }
    }

    const ts = Date.now()
    const node: StepNode = {
      id: e.tool_use_id,
      at: hhmm(ts),
      ts,
      title,
      status,
      ...(cause ? { cause } : {}),
      ...(attempts.length ? { attempts } : {}),
      ...(fix ? { fix } : {}),
      ...(detail ? { detail } : {}),
      ...(status === 'deferred' ? { okReason } : {}),
      ...(status === 'blocked' ? { notDone } : {}),
      ...(isDecision ? { options, interim } : {}),
      ...(failure && options.length ? { options } : {}),
    }
    // Eviction order: done, other settled nodes, failures not yet fixed or chosen, open choices last; oldest first, never the new node.
    const rank = (n: StepNode) => (n.status === 'done' ? 0 : isOpen(norm(n)) ? 3 : isKept(norm(n)) ? 2 : 1)
    const after = (
      await update($, nodes, list => {
        const next = [...list, node]
        while (next.length > MAX) {
          let i = 0
          next.forEach((n, j) => {
            if (j < next.length - 1 && rank(n) < rank(next[i] as StepNode)) i = j
          })
          next.splice(i, 1)
        }

        return next
      })
    ).map(norm)
    // Docked, the list window follows its end by itself.
    if (dock.rows === 0) {
      $.ui
        .panes()
        .then(panes => {
          if (!panes.some(p => p.id === PANE && p.isFocused)) {
            return $.ui.scroll({ in: PANE, to: 'end' })
          }
        })
        .catch(() => {})
    }
    // The count of what still waits for the user survives a compaction in this line.
    const k = pendingCount(after)
    const m = blockedCount(after)
    const open = k + m > 0 ? ` Open: ${k} to decide, ${m} blocked.` : ''
    const text = isDecision
      ? `recorded decision ${e.tool_use_id}. The user can decide in the step-flow pane; if the user answers in chat instead, call ${TOOL_DECIDED} with this id and the chosen option number.`
      : failure
        ? `recorded ${status} ${e.tool_use_id}. When you fix it later, call ${TOOL_RESOLVE} with this id and the fix.${
            options.length ? ' The user can pick an option in the step-flow pane.' : ''
          }`
        : 'recorded'

    return { result: `${text}${open}` }
  })

  // No matcher: the generated MCP types list only tools that existed when the mod was last saved.
  on('tool.run', async ($, e, next) => {
    const tool = e.tool as string
    if (tool !== TOOL_DECIDED && tool !== TOOL_RESOLVE) return next(e)
    const input = e as unknown as Record<string, unknown>
    const list = (await read($, nodes)).map(norm)
    const id = str(input.id)
    const listOf = (items: StepNode[]) => items.map(n => `${n.id} "${n.title}" (${n.status})`).join('; ')

    if (tool === TOOL_RESOLVE) {
      const open = list.filter(isFailure)
      const openText = open.length
        ? `Open failures: ${listOf(open)}.`
        : 'No deferred or blocked step exists.'
      const n = id ? list.find(x => x.id === id) : open.length === 1 ? open[0] : undefined
      if (!n || !isFailure(n)) {
        const why = !id ? 'id is missing' : n ? `${id} "${n.title}" is ${n.status}, not deferred or blocked` : `unknown id ${id}`

        return { deny: `${why}. ${openText} Call ${TOOL_RESOLVE} again with one of these ids.` }
      }
      const fix = str(input.fix)
      const given = Array.isArray(input.attempts) ? input.attempts : []
      const more: StepAttempt[] = given.map(a => ({
        action: str((a as Record<string, unknown> | null)?.action),
        reason: str((a as Record<string, unknown> | null)?.reason),
      }))
      const missing: string[] = []
      if (!fix) missing.push('fix')
      more.forEach((a, i) => {
        if (!a.action) missing.push(`attempts[${i + 1}].action`)
        if (!a.reason) missing.push(`attempts[${i + 1}].reason`)
      })
      if (missing.length) return { deny: `missing: ${missing.join('; ')}. Call ${TOOL_RESOLVE} again with these fields filled in.` }
      const resolvedAt = Date.now()
      // Back to a plain resolved step: cause and attempts stay, the pending choice and the failure's notes go.
      await update($, nodes, l =>
        l.map(x => {
          if (x.id !== n.id) return x
          const { options: _o, chosen: _c, okReason: _k, notDone: _d, ...rest } = norm(x)

          return { ...rest, status: 'resolved' as const, fix, resolvedAt, attempts: [...(x.attempts ?? []), ...more] }
        }),
      )

      return { result: `resolved ${n.id} "${n.title}". Fix: ${fix}` }
    }

    // choice 0 reopens a choice: the pane's pick is cleared and the buttons come back.
    if (input.choice === 0) {
      const set = list.filter(x => (x.status === 'decision' ? x.decided : isFailure(x) && x.chosen))
      const target = id ? list.find(x => x.id === id) : set.length === 1 ? set[0] : undefined
      if (!target) {
        const why = id ? `unknown id ${id}` : 'id is missing (more than one step has a choice, or none)'

        return {
          deny: `${why}. ${set.length ? `Steps with a choice: ${listOf(set)}.` : 'No step has a choice set.'} Call ${TOOL_DECIDED} again with one of these ids.`,
        }
      }
      const isSet = target.status === 'decision' ? target.decided : isFailure(target) && target.chosen
      if (!isSet) return { result: `nothing to reopen: "${target.title}" is ${target.status}` }
      const key = target.status === 'decision' ? 'decided' : 'chosen'
      await update($, nodes, l => l.map(x => (x.id === target.id ? { ...x, [key]: undefined } : x)))

      return { result: `reopened ${target.id} "${target.title}"` }
    }

    const open = list.filter(isOpen)
    const openText = open.length ? `Open choices: ${listOf(open)}.` : 'No choice is open.'
    const n = id ? list.find(x => x.id === id) : open.length === 1 ? open[0] : undefined
    const hasChoice = n && (n.status === 'decision' || (isFailure(n) && (n.options?.length ?? 0) > 0))
    if (!n || !hasChoice) {
      const why = !id
        ? 'id is missing (more than one choice is open, or none)'
        : n
          ? `${id} "${n.title}" is ${n.status} with no choice to make`
          : `unknown id ${id}`

      return { deny: `${why}. ${openText} Call ${TOOL_DECIDED} again with one of these ids.` }
    }
    const count = n.options?.length ?? 0
    const choice = input.choice
    if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 1 || choice > count) {
      return { deny: `choice must be a whole number from 1 to ${count} for "${n.title}".` }
    }
    const picked = { choice: choice - 1, ts: Date.now() }
    const key = n.status === 'decision' ? 'decided' : 'chosen'
    await update($, nodes, l => l.map(x => (x.id === n.id ? { ...x, [key]: picked } : x)))

    return { result: `recorded ${n.id} "${n.title}": ${letter(choice - 1)} (${n.options?.[choice - 1]?.option ?? ''})` }
  })

  // Docked pane: the plugin draws its own window, so the engine's never moves; a scroll moves ours.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const d = dock
    if (d.rows <= 0) return next(e)
    const v = await viewOf($, d)
    const l = layoutOf(v)
    const detailOpen = v.list.some(n => n.id === v.selectedId)
    const from = windowStart(detailOpen ? await read($, detailView) : await read($, listView), l)
    const target = from + e.by
    const offset = Math.min(e.by > 0 ? l.snapUp(target) : l.snapDown(Math.max(0, target)), l.end)
    const moved = { offset, follow: offset >= l.end }
    if (detailOpen) await update($, detailView, () => moved)
    else await update($, listView, () => moved)

    return {}
  })

  // Keyboard focus on a row at the window's edge: bring its neighbours into view. Never refuses the move (a click
  // is not told from Tab here, and refusing would block clicks on the input).
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    focusSeq++
    const r = await next(e)
    if (!r.deny && e.element && (await reveal($, e.element).catch(() => false)) === 'moved') focusSoon($, e.element)

    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as FullUi
    const { Box, Text, Button, Input, Select } = ui
    const t = tr(await localeOf($))
    const list = (await read($, nodes)).map(norm)
    const themeId = asTheme(await read($, theme))
    const selectedId = await read($, selected)
    const btwList = await read($, btw)
    const inputN = await read($, btwInput)
    const bg = await read($, rowBg)
    const pickerOpen = await read($, themePicker)
    const { bodyColumns, placement, scroll } = e.props
    // Docked: the pane is a fullscreen sidebar with a known height; else one scrolling body as before.
    const pinned = e.viewport?.isFullscreen === true && scroll.bodyRows > 0
    const size = { cols: bodyColumns, rows: pinned ? scroll.bodyRows : 0 }
    dock = size
    // Opening a step starts its window at the top; going back finds the list's window as it was.
    // An open choice gets its first button into the window; the keyboard starts on back, not on a choice.
    const select = async (id: string) => {
      if (id) await update($, detailView, () => ({ offset: 0, follow: false }))
      await update($, selected, () => id)
      if (!id) return
      const open = (await read($, nodes)).map(norm).find(x => x.id === id)
      if (open && isOpen(open)) await reveal($, 'decide-A')
      focusSoon($, 'back')
    }
    // Pane choice: mark it and send it to the model as the user's words, without waiting for the turn
    // (submit resolves once the session is idle); undo when it is refused. Works on a pending decision and on
    // a deferred or blocked step with options; the prompt names when the step was recorded and how many came after.
    const decide = async (n: StepNode, i: number) => {
      const all = (await read($, nodes)).map(norm)
      const at = all.findIndex(x => x.id === n.id)
      const cur = all[at]
      const opt = cur?.options?.[i]
      if (!cur || !opt || !isOpen(cur)) return
      let taken = false
      await update($, deciding, l => {
        taken = !l.includes(cur.id)

        return taken ? [...l, cur.id] : l
      })
      if (!taken) return
      const ts = Date.now()
      const key = cur.status === 'decision' ? 'decided' : 'chosen'
      const mark = (pick: StepNode['decided']) =>
        update($, nodes, l => l.map(x => (x.id === cur.id ? { ...x, [key]: pick } : x)))
      await mark({ choice: i, ts })
      // Back to the list, then the keyboard goes to the first choice still open.
      await select('')
      const next = (await read($, nodes)).map(norm).find(isOpen)
      if (next) {
        focusSoon($, next.id)
      }
      const release = () => update($, deciding, l => l.filter(x => x !== cur.id))
      const revert = async () => {
        await update($, nodes, l =>
          l.map(x => (x.id === cur.id && x[key]?.ts === ts ? { ...x, [key]: undefined } : x)),
        )
        $.ui.toast(t.decideFailed)
        await release()
      }
      const since = all.length - 1 - at
      const text =
        cur.status === 'decision'
          ? t.decisionPrompt(cur.title, letter(i), opt.option, opt.note, cur.cause ?? '', cur.id, cur.at, since)
          : t.goPrompt(cur.title, word(t, cur), letter(i), opt.option, opt.note, cur.cause ?? '', cur.id, cur.at, since)
      void $.prompt.submit({ text }).then(async r => {
        if (r.drop !== undefined) await revert()
        else await release()
      }, revert)
    }
    const node = list.find(n => n.id === selectedId)
    const back = async () => {
      await select('')
      if (!pinned) await $.ui.scroll({ in: PANE, to: { key: node?.id ?? '' } }).catch(() => {})
      else if (node) {
        focusSoon($, node.id)
      }
    }
    // Closing hides the exchange everywhere and no older one takes its place; a late answer stays hidden too.
    const close = () => update($, btw, l => l.map(x => ({ ...x, closed: true as const })))
    const view: View = { ui, t, list, themeId, selectedId, btwList, pickerOpen, bg, cols: bodyColumns, rows: size.rows, select, decide, back, close }

    const submit = async (raw: string) => {
      const q = raw.trim()
      const id = `${Date.now()}-${++btwSeq}`
      const sel = await read($, selected)
      const nodeId = (await read($, nodes)).some(n => n.id === sel) ? sel : undefined
      // Docked: a new question puts its exchange in view until the person scrolls; a late answer needs no move.
      const toEnd = async (asked: boolean) => {
        if (!pinned) return $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {})
        if (!asked) return
        // `follow` stays as it was: closing the exchange later puts a following view back at the end.
        if (nodeId) await update($, detailView, w => ({ ...w, ask: true }))
        else await update($, listView, w => ({ ...w, ask: true }))
      }
      const patch = async (p: Partial<BtwEntry>) => {
        await update($, btw, l => l.map(x => (x.id === id ? { ...x, ...p, pending: false } : x)))
        void toEnd(false)
      }
      if (q) {
        await update($, btw, l => [...l, { id, q, pending: true, ...(nodeId ? { nodeId } : {}) }].slice(-BTW_KEEP))
        void toEnd(true)
      }
      // A new key draws an empty field (also for a blank submit); then the keyboard goes back to it.
      const nextKey = `btw:${await update($, btwInput, n => n + 1)}`
      $.ui.focus({ requestId: PANE, key: nextKey }).catch(() => {})
      if (!q) return
      try {
        const msgs: unknown = await $.session.messages({ as: 'api' }).catch((x: unknown) => ({ deny: String(x) }))
        let transcript = '(session transcript unavailable)'
        if (Array.isArray(msgs)) {
          const flat = flatten(msgs)
          transcript = flat.length > 120000 ? `[earlier part cut]\n${flat.slice(-120000)}` : flat
        } else if (typeof (msgs as { deny?: unknown } | null)?.deny === 'string') {
          transcript = `(session transcript unavailable: ${(msgs as { deny: string }).deny})`
        }
        const nodesNow = (await read($, nodes)).map(norm)
        const open = nodesNow.find(n => n.id === nodeId)
        const context = [
          '# Session transcript (newest last)',
          transcript,
          '# Work log (step-flow)',
          nodesNow.map(n => nodeLog(n, t)).join('\n\n') || '(no steps recorded)',
          ...(open ? [t.viewing(open.title, open.at)] : []),
        ].join('\n\n')
        const r = await $.model.complete({
          model: 'sonnet',
          system: BTW_RULES,
          prompt: [{ text: context, cache: true }, { text: `Question: ${q}` }],
          maxTokens: 1500,
          timeoutMs: 90000,
        })
        if (r.isAnswered && r.text.trim()) await patch({ a: r.text.trim() })
        else {
          const why = r.isAnswered ? 'empty-reply' : `${r.reason}${'status' in r && r.status != null ? ` ${r.status}` : ''}`
          await patch({ error: why })
        }
      } catch (err) {
        await patch({ error: err instanceof Error ? err.message : String(err) })
      }
    }
    const last = lastExchange(view)
    const qa = last && exchange(view, last)
    const pick = async (v: string) => {
      const n = asTheme(Number(v))
      await $.store.set('theme', n)
      await update($, theme, () => n)
      await update($, themePicker, () => false)
      $.ui.focus({ requestId: PANE, key: `btw:${await read($, btwInput)}` }).catch(() => {})
    }
    const picker = pickerOpen && (
      <Box flexDirection="column" width={bodyColumns} flexShrink={0}>
        <Text dimColor>{t.themePickerTitle}</Text>
        <Select
          autoFocus
          key="theme-picker"
          value={String(themeId)}
          options={THEME_IDS.map(id => ({
            value: String(id),
            label: `${id}  ${t.themes[id]}${id === themeId ? `  (${t.current})` : ''}`,
          }))}
          onSelect={pick}
        />
        <Button key="theme-close" onPress={() => update($, themePicker, () => false)}>{t.close}</Button>
      </Box>
    )
    const rule = <Text color="subtle" wrap="truncate-end">{'─'.repeat(bodyColumns > 0 ? bodyColumns : 40)}</Text>
    const input = (
      <Input
        autoFocus
        key={`btw:${inputN}`}
        label={t.btwLabel}
        placeholder={t.btwPlaceholder}
        value=""
        submitLabel=""
        onSubmit={submit}
      />
    )
    const summaryRows = wrapRows(summaryText(list, t), bodyColumns - 2)
    const footer = (
      <Box width={bodyColumns} height={summaryRows} flexShrink={0} paddingX={1} backgroundColor="inverseText">
        <Text wrap="wrap">
          {`${t.steps(list.length)}, `}
          <Text color={pendingCount(list) ? 'warning' : 'success'}>{t.toDecide(pendingCount(list))}</Text>
          {', '}
          <Text color={blockedCount(list) ? 'error' : 'success'}>{t.blockedN(blockedCount(list))}</Text>
          {', '}
          <Text color={deferredCount(list) ? 'inactive' : 'success'}>{t.deferredN(deferredCount(list))}</Text>
        </Text>
      </Box>
    )

    if (pinned) {
      const l = layoutOf(view)
      const offset = windowStart(node ? await read($, detailView) : await read($, listView), l)
      const first = Math.max(0, l.starts.indexOf(offset))
      const shown = l.units.filter((_, i) => i >= first && (l.starts[i] ?? 0) < offset + l.regionRows)
      const lastShown = first + shown.length - 1
      const afterStop = l.units.find((u, i) => i > lastShown && u.focus)
      const beforeStop = l.units.findLast((u, i) => i < first && u.focus)
      const below = l.total - offset - l.regionRows
      // The ✕ sits at the right end of the question row (a cell of margin, the button, a cell of margin): a
      // marker on that row moves left of it, one cell between them.
      const qRow = l.questionStart === undefined ? -1 : l.questionStart - offset
      const upRight = qRow === 0 ? 3 : 0
      const downRight = qRow === l.regionRows - 1 ? 3 : 0

      return (
        <Box flexDirection="column" width={bodyColumns} height={scroll.bodyRows} overflow="hidden">
          {l.fixed.length > 0 && (
            <Box flexDirection="column" width={bodyColumns} height={l.pinnedRows} flexShrink={0}>
              {l.fixed.map(u => <Box flexShrink={0}>{u.el}</Box>)}
            </Box>
          )}
          <Box width={bodyColumns} height={l.regionRows} flexShrink={1} overflow="hidden">
            {/* The focusable rows just outside the window are drawn, cut off: Tab and the arrows must reach them for ui.focus to move the window. */}
            {beforeStop && (
              <Box key="focus-before" position="absolute" top={-beforeStop.rows} left={0} width={bodyColumns}>
                {beforeStop.el}
              </Box>
            )}
            <Box flexDirection="column" width={bodyColumns} flexShrink={0}>
              {shown.map(u => <Box flexShrink={0}>{u.el}</Box>)}
              {afterStop && <Box key="focus-after" flexShrink={0}>{afterStop.el}</Box>}
            </Box>
            {offset > 0 && (
              <Box position="absolute" top={0} right={upRight}><Text dimColor>{`↑ ${offset}`}</Text></Box>
            )}
            {below > 0 && (
              <Box position="absolute" bottom={0} right={downRight}><Text dimColor>{`↓ ${below}`}</Text></Box>
            )}
          </Box>
          {footer}
          {picker}
          {rule}
          <Box width={bodyColumns} height={1} flexShrink={0} overflow="hidden">{input}</Box>
        </Box>
      )
    }

    const body = <Box flexDirection="column">{viewUnits(view).map(u => u.el)}</Box>
    const btwBlock = (
      <Box flexDirection="column" width={bodyColumns} flexShrink={0}>
        {picker}
        {rule}
        {qa && (
          <Box flexDirection="column" marginBottom={1}>
            {qa.question}
            <Box marginTop={1}>{qa.answer}</Box>
          </Box>
        )}
        {input}
      </Box>
    )

    return (
      <Box
        flexDirection="column"
        width={bodyColumns}
        minHeight={placement === 'dock' ? scroll.bodyRows : 0}
        overflow="hidden"
      >
        {body}
        <Box flexGrow={1} />
        {footer}
        {btwBlock}
      </Box>
    )
  })
}
