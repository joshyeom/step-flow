import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BtwEntry, StepAttempt, StepNode, StepStatus } from '../types'
import { type Strings, toLocale, tr } from './i18n'
import { BODIES, cells, cut, detail, label, STATUS, THEME_IDS } from './themes'

const PANE = 'step-flow'
const TOOL = 'mcp__step-flow__step'
const nodes = atom({ plugin: 'step-flow', key: 'nodes' } as const, [], {
  shape: 'nodes-2',
})
const theme = atom({ plugin: 'step-flow', key: 'theme' } as const, 7)
const selected = atom({ plugin: 'step-flow', key: 'selected' } as const, '')
const btw = atom({ plugin: 'step-flow', key: 'btw' } as const, [])
const locale = atom({ plugin: 'step-flow', key: 'locale' } as const, 'en')
// Bumped on every btw submit: a new Input key draws a fresh, empty field.
const btwInput = atom({ plugin: 'step-flow', key: 'btwInput' } as const, 0)
// Background of the question row, picked from the `theme` setting at session start.
const rowBg = atom({ plugin: 'step-flow', key: 'rowBg' } as const, '#3a3a3a')
// True while the theme picker is drawn in the pane's bottom block.
const themePicker = atom({ plugin: 'step-flow', key: 'themePicker' } as const, false)

const DESCRIPTION =
  "Record one finished unit of work as a node in the step-flow side pane. The user reads this pane when they come back to see what happened while they were away, so call it once each time a meaningful step ends (a stage of the task, not every tool call), in order. status: 'done' = it worked the first time; 'resolved' = it failed, then you fixed it; 'workaround' = you could not fix it and moved on another way; 'unresolved' = still broken or blocked. cause = the problem and why it happened (required unless done). attempts = each thing you tried, every one WITH the reason you tried it ({ action, reason }); required for resolved and workaround. fix = what finally made it pass, or how you moved on (required for resolved and workaround; ignored for unresolved). detail = optional longer notes (what you checked, numbers, file paths, commands) shown when the user opens the step. A call missing a required field is denied with the field names: call again with them. Keep title under 40 characters. Write title, cause, attempts, fix and detail in the language the user writes in."

const REMINDER =
  "A step-flow side pane shows the user what happened while they were away. Each time a meaningful step of a task ends, call mcp__step-flow__step, as it finishes and not all at the end. status: 'done' = it worked the first time; 'resolved' = it failed, then you fixed it; 'workaround' = you could not fix it and moved on another way; 'unresolved' = still broken or blocked. For anything but done give cause (the problem and why). For resolved and workaround also give attempts (each thing you tried WITH the reason you tried it) and fix (what finally made it pass, or how you moved on). detail is optional longer notes (what you checked, numbers, file paths, commands) the user sees when they open the step. Keep title under 40 characters and write in the user's language."

const MAX = 200
const BTW_KEEP = 50
const BTW_RULES =
  "You answer a side question about an ongoing Claude Code session. Use only the transcript and work log given; if the answer is not there, say you don't know. You cannot run tools or change anything. Answer briefly, in the language of the question. The answer is rendered as markdown in a narrow side pane, so keep it short and use at most simple bullet lists and bold, no headings or tables."
const DEFAULT_THEME = 7
// Of the 100,000 serialized characters a render tree may hold, what the list view may spend.
const TREE_BUDGET = 90000

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (ts: number) => {
  const d = new Date(ts)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const asTheme = (v: unknown) =>
  typeof v === 'number' && THEME_IDS.includes(v) ? v : DEFAULT_THEME

// Rows a text takes when wrapped at spaces in `cols` cells (long words split).
const wrapRows = (s: string, width: number) => {
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
  const lines = [`[${n.at}] ${n.title} (${label(t, n.status)})`]
  if (n.cause) lines.push(`${n.status === 'unresolved' ? t.cause : t.problem}: ${n.cause}`)
  n.attempts?.forEach((a, i) => lines.push(`${t.attempt(i + 1)}: ${a.action} (${t.reason(a.reason)})`))
  if (n.status === 'unresolved') lines.push(`${t.fix}: ${t.unresolved}`)
  else if (n.fix) lines.push(`${t.fix}: ${n.fix}`)
  if (n.detail) lines.push(`${t.detail}: ${n.detail}`)

  return lines.join('\n')
}

let btwSeq = 0

// Summary: step count, then the failure count (unresolved nodes), always shown.
const failedCount = (list: StepNode[]) => list.filter(n => n.status === 'unresolved').length

const summaryText = (list: StepNode[], t: Strings) =>
  `${t.steps(list.length)}, ${t.failedN(failedCount(list))}`

// Rough serialized size of a node in the list views (texts cut as they are drawn).
const weight = (n: StepNode) =>
  700 +
  n.title.length +
  (n.status === 'done'
    ? 0
    : [n.cause, n.fix, ...(n.attempts ?? []).flatMap(a => [a.action, a.reason])].reduce<number>(
        (w, x) => w + 300 + cut(x ?? '').length, // blank line + row
        0,
      ))

// Nodes the list views draw, under the tree limit: oldest done nodes go first, then the oldest of
// the rest; the newest node always stays.
const visible = (list: StepNode[]) => {
  let total = list.reduce((w, n) => w + weight(n), 0)
  const newest = list[list.length - 1]
  const skip = new Set<string>()
  for (const n of [...list.filter(x => x.status === 'done'), ...list.filter(x => x.status !== 'done')]) {
    if (total <= TREE_BUDGET) break
    if (n === newest) continue
    skip.add(n.id)
    total -= weight(n)
  }

  return { shown: list.filter(n => !skip.has(n.id)), hidden: skip.size }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const lang =
      str(await $.settings.read({ key: 'language' })) ||
      (await $.env.get('LANG')) ||
      (await $.env.get('LC_ALL'))
    const loc = toLocale(lang)
    await update($, locale, () => loc)
    const bg = str(await $.settings.read({ key: 'theme' })).includes('light') ? '#f0f0f0' : '#3a3a3a'
    await update($, rowBg, () => bg)
    const t = tr(loc)
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
            enum: ['done', 'resolved', 'workaround', 'unresolved'],
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
        },
        required: ['title', 'status'],
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

  on('prompt.compose', async (_$, e, next) => {
    const r = await next(e)

    return {
      ...r,
      sections: [
        ...r.sections,
        { id: 'step-flow:reminder', text: REMINDER, scope: 'session' as const },
      ],
    }
  })

  on('command.run', { command: 'flow' }, async $ => {
    const t = tr(await read($, locale))
    await $.ui.open({ id: PANE, title: t.paneTitle })

    return { text: t.flowOpened }
  })

  on('command.run', { command: 'flow-clear' }, async $ => {
    await update($, nodes, () => [])
    await update($, selected, () => '')

    return { text: tr(await read($, locale)).flowCleared }
  })

  on('command.run', { command: 'flow-theme' }, async ($, e) => {
    const t = tr(await read($, locale))
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
    try {
      await $.ui.scroll({ in: PANE, to: { key: 'theme-picker' } })
    } catch {}

    return { text: t.themePickerOpened }
  })

  on('tool.run', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const status = input.status as StepStatus
    if (typeof status !== 'string' || !Object.hasOwn(STATUS, status)) {
      return { deny: 'status must be one of: done, resolved, workaround, unresolved' }
    }
    const title = str(input.title)
    const cause = str(input.cause)
    const fix = str(input.fix)
    const detail = str(input.detail)
    const given = Array.isArray(input.attempts) ? input.attempts : []
    const attempts: StepAttempt[] = given.map(a => ({
      action: str((a as Record<string, unknown> | null)?.action),
      reason: str((a as Record<string, unknown> | null)?.reason),
    }))

    if (status === 'done' && (cause || fix)) {
      return {
        deny: 'done cannot have cause or fix; if it failed first, call again with status resolved or workaround (with attempts and fix)',
      }
    }
    const missing: string[] = []
    if (!title) missing.push('title')
    if (status !== 'done' && !cause) missing.push('cause')
    if (status === 'resolved' || status === 'workaround') {
      if (attempts.length === 0) missing.push('attempts (at least 1)')
    }
    attempts.forEach((a, i) => {
      if (!a.action) missing.push(`attempts[${i + 1}].action`)
      if (!a.reason) missing.push(`attempts[${i + 1}].reason`)
    })
    if ((status === 'resolved' || status === 'workaround') && !fix) missing.push('fix')
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
      ...(fix && status !== 'unresolved' ? { fix } : {}),
      ...(detail ? { detail } : {}),
    }
    await update($, nodes, list => {
      const next = [...list, node]
      // evict the oldest done node (not the new one); with none left, the oldest node
      while (next.length > MAX) {
        const i = next.findIndex((n, j) => j < next.length - 1 && n.status === 'done')
        next.splice(Math.max(i, 0), 1)
      }

      return next
    })
    $.ui
      .panes()
      .then(panes => {
        if (!panes.some(p => p.id === PANE && p.isFocused)) {
          return $.ui.scroll({ in: PANE, to: 'end' })
        }
      })
      .catch(() => {})

    return { result: 'recorded' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input, Markdown, Select } = ui
    const t = tr(await read($, locale))
    const list = await read($, nodes)
    const themeId = asTheme(await read($, theme))
    const selectedId = await read($, selected)
    const btwList = await read($, btw)
    const inputN = await read($, btwInput)
    const bg = await read($, rowBg)
    const pickerOpen = await read($, themePicker)
    const { bodyColumns, placement, scroll } = e.props
    const select = (id: string) => update($, selected, () => id)
    const { shown, hidden } = visible(list)
    const ctx = { ui, list: shown, all: list, width: bodyColumns, t, select }
    const detailCtx = { ...ctx, list }

    const summaryRows = wrapRows(summaryText(list, t), bodyColumns - 2)
    const footer = (
      <Box width={bodyColumns} height={summaryRows} flexShrink={0} paddingX={1} backgroundColor="inverseText">
        <Text wrap="wrap">
          {`${t.steps(list.length)}, `}
          <Text color={failedCount(list) ? 'error' : 'success'}>{t.failedN(failedCount(list))}</Text>
        </Text>
      </Box>
    )

    const node = list.find(n => n.id === selectedId)
    let body
    if (node) {
      const start = list[list.indexOf(node) - 1]?.ts ?? node.ts
      const minutes = Math.floor((node.ts - start) / 60000)
      const span = `${hhmm(start)} ~ ${hhmm(node.ts)} (${minutes < 1 ? t.lessThanMinute : t.minutes(minutes)})`
      const back = async () => {
        await select('')
        await $.ui.scroll({ in: PANE, to: { key: node.id } }).catch(() => {})
      }
      body = (
        <Box flexDirection="column" rowGap={1}>
          <Box>
            <Button key="back" onPress={back}>{t.back}</Button>
          </Box>
          {detail(detailCtx, node, span)}
        </Box>
      )
    } else if (list.length === 0) {
      body = <Text dimColor>{t.empty}</Text>
    } else {
      body = (
        <Box flexDirection="column">
          {hidden > 0 && <Text dimColor>{t.hidden(hidden)}</Text>}
          {BODIES[themeId]?.(ctx)}
        </Box>
      )
    }

    const submit = async (raw: string) => {
      const q = raw.trim()
      const id = `${Date.now()}-${++btwSeq}`
      const sel = await read($, selected)
      const nodeId = (await read($, nodes)).some(n => n.id === sel) ? sel : undefined
      const toEnd = () => $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {})
      const patch = async (p: Partial<BtwEntry>) => {
        await update($, btw, l => l.map(x => (x.id === id ? { ...x, ...p, pending: false } : x)))
        void toEnd()
      }
      if (q) {
        await update($, btw, l => [...l, { id, q, pending: true, ...(nodeId ? { nodeId } : {}) }].slice(-BTW_KEEP))
        void toEnd()
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
        const nodesNow = await read($, nodes)
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
    // List view: the latest exchange overall; detail view: the latest one asked on that node.
    const last = node ? btwList.findLast(x => x.nodeId === node.id) : btwList[btwList.length - 1]
    // Same look as the transcript: a mark column of 2 cells, then the text with a hanging indent.
    const row = (mark: ReturnType<typeof Text>, body: ReturnType<typeof Text>) => (
      <Box>
        <Box width={2} flexShrink={0}>{mark}</Box>
        <Box flexDirection="column" flexGrow={1} minWidth={0}>{body}</Box>
      </Box>
    )
    let answer
    if (last?.pending) {
      answer = row(<Text color="claude">{'✻ '}</Text>, <Text dimColor>{t.btwPending}</Text>)
    } else if (last?.error !== undefined) {
      answer = row(<Text color="error">{'⏺ '}</Text>, <Text color="error" wrap="wrap">{t.btwFailed(last.error)}</Text>)
    } else if (last) {
      answer = row(<Text>{'⏺ '}</Text>, <Markdown text={last.a ?? ''} />)
    }
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
    const btwBlock = (
      <Box flexDirection="column" width={bodyColumns} flexShrink={0}>
        {picker}
        <Text color="subtle" wrap="truncate-end">{'─'.repeat(bodyColumns > 0 ? bodyColumns : 40)}</Text>
        {last && (
          <Box flexDirection="column" marginBottom={1}>
            <Box backgroundColor={bg} width={bodyColumns}>
              {row(<Text color="#949494">{'❯ '}</Text>, <Text wrap="wrap">{last.q.replace(/\s+/g, ' ')}</Text>)}
            </Box>
            <Box marginTop={1}>{answer}</Box>
          </Box>
        )}
        <Input
          autoFocus
          key={`btw:${inputN}`}
          label={t.btwLabel}
          placeholder={t.btwPlaceholder}
          value=""
          submitLabel=""
          onSubmit={submit}
        />
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
