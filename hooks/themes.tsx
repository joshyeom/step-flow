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
}

// Terminal cells: Korean and other wide characters take two.
export const cells = (s: string) =>
  [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0)

// Display is two-way: only unresolved is a failure; done, resolved and workaround all show as success.
const OK = { color: 'success', glyph: '✓' } as const
export const STATUS: Record<StepStatus, { color: 'success' | 'error'; glyph: string }> = {
  done: OK,
  resolved: OK,
  workaround: OK,
  unresolved: { color: 'error', glyph: '✗' },
}
export const label = (t: Strings, s: StepStatus) => (s === 'unresolved' ? t.failed : t.ok)

export const THEME_IDS: readonly number[] = [1, 2, 3, 4, 5, 7]

const CUT = 300
// List views cut long texts; the detail view does not use this.
export const cut = (s: string) => (s.length <= CUT ? s : `${s.slice(0, CUT)}…`)

// Cause, every attempt (action, then its reason below) and fix as blocks, each after a blank line (list views).
export const fields = ({ ui: { Box, Text }, t }: Ctx, n: StepNode) => {
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
          {dim(`${n.status === 'unresolved' ? t.cause : t.problem}: `)}
          {c(n.cause)}
        </Text>,
      ),
    )
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
  if (n.status === 'unresolved') {
    rows.push(block(<Text color="error" weight="bold">{`${t.fix}: ${t.unresolved}`}</Text>))
  } else if (n.fix) {
    rows.push(
      block(
        <Text>
          {dim(`${t.fix}: `)}
          {c(n.fix)}
        </Text>,
      ),
    )
  }

  return rows
}

// Detail view body below the back button: badge + title, time span, label column rows.
export const detail = ({ ui: { Box, Text }, t, width }: Ctx, n: StepNode, span: string) => {
  const s = STATUS[n.status]
  const failed = n.status === 'unresolved'
  const rule = <Text color="subtle" wrap="truncate-end">{'─'.repeat(width > 0 ? width : 40)}</Text>
  const labels = [
    ...(n.cause ? [failed ? t.cause : t.problem] : []),
    ...(n.attempts ?? []).map((_, i) => t.attempt(i + 1)),
    ...(failed || n.fix ? [t.fix] : []),
    ...(n.detail ? [t.detail] : []),
  ]
  const lw = Math.max(0, ...labels.map(cells)) + 2
  const row = (label: string, body: ReturnType<typeof Text>[], labelColor: 'inactive' | 'error' = 'inactive') => (
    <Box>
      <Box width={lw} flexShrink={0}><Text color={labelColor}>{label}</Text></Box>
      <Box flexDirection="column" flexGrow={1} minWidth={0}>{body}</Box>
    </Box>
  )
  const groups = [
    n.cause ? [row(failed ? t.cause : t.problem, [<Text wrap="wrap">{n.cause}</Text>], failed ? 'error' : 'inactive')] : [],
    (n.attempts ?? []).map((a, i) =>
      row(
        t.attempt(i + 1),
        [
          <Text wrap="wrap">{a.action}</Text>,
          <Text color="inactive" wrap="wrap">{t.reason(a.reason)}</Text>,
        ],
      ),
    ),
    failed
      ? [row(t.fix, [<Text color="error" weight="bold">{t.unresolved}</Text>])]
      : n.fix
        ? [row(t.fix, [<Text wrap="wrap">{n.fix}</Text>])]
        : [],
  ].filter(g => g.length)

  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Box flexShrink={0}>
          <Text color={s.color} weight="bold" inverse>{` ${label(t, n.status)} `}</Text>
        </Box>
        <Text weight="bold" wrap="wrap">{n.title}</Text>
      </Box>
      <Text color="inactive">{span}</Text>
      {rule}
      <Box flexDirection="column" rowGap={1}>
        {groups.map(g => (
          <Box flexDirection="column">{g}</Box>
        ))}
      </Box>
      {n.detail && rule}
      {n.detail && row(t.detail, [<Text wrap="wrap">{n.detail}</Text>])}
    </Box>
  )
}

const title = ({ ui: { Button, Text }, select }: Ctx, n: StepNode) => (
  <Button plain key={n.id} onPress={() => select(n.id)}>
    {n.status === 'unresolved' ? (
      <Text color="error" weight="bold">{n.title}</Text>
    ) : (
      n.title
    )}
  </Button>
)

const tag = ({ ui: { Text }, t }: Ctx, n: StepNode) => (
  <Text color={STATUS[n.status].color} weight="bold" inverse>{` ${label(t, n.status)} `}</Text>
)

// glyph, time, title button, label tag (failed only)
const head = (ctx: Ctx, n: StepNode) => {
  const { Box, Text } = ctx.ui

  return (
    <Box columnGap={1}>
      <Text color={STATUS[n.status].color}>{STATUS[n.status].glyph}</Text>
      <Text color="inactive">{n.at}</Text>
      {title(ctx, n)}
      {n.status === 'unresolved' && tag(ctx, n)}
    </Box>
  )
}

const theme1 = (ctx: Ctx) => {
  const { Box, Text } = ctx.ui

  return (
    <Box flexDirection="column">
      {ctx.list.map((n, i) => (
        <Box flexDirection="column">
          {i > 0 && (
            <Box justifyContent="center">
              <Text color="inactive">↓</Text>
            </Box>
          )}
          <Box flexDirection="column" borderStyle="round" borderColor={STATUS[n.status].color} paddingX={1}>
            {head(ctx, n)}
            {n.status !== 'done' && fields(ctx, n)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const theme2 = (ctx: Ctx) => {
  const { Box, Text } = ctx.ui

  return (
    <Box flexDirection="column">
      {ctx.list.map((n, i) => {
        const s = STATUS[n.status]
        const last = i === ctx.list.length - 1

        return (
          <Box columnGap={1}>
            <Box flexDirection="column" flexShrink={0} width={1}>
              <Text color={s.color}>{n.status === 'unresolved' ? '○' : '●'}</Text>
              {!last && (
                // The rail starts under the dot and runs into the next row, where the next dot covers its end.
                <Box position="absolute" top={1} bottom={-1} width={1} overflow="hidden">
                  <Text color="subtle">{'│\n'.repeat(40)}</Text>
                </Box>
              )}
            </Box>
            <Box flexDirection="column" flexGrow={1} minWidth={0} paddingBottom={last || n.status === 'done' ? 0 : 1}>
              <Box columnGap={1}>
                <Text color="inactive">{n.at}</Text>
                {title(ctx, n)}
                {n.status === 'unresolved' && tag(ctx, n)}
              </Box>
              {n.status !== 'done' && (
                <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
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

const theme3 = (ctx: Ctx) => {
  const { Box } = ctx.ui
  const failed = ctx.all.filter(n => n.status === 'unresolved').length
  const widths = split([ctx.all.length - failed, failed], ctx.width)

  return (
    <Box flexDirection="column">
      {ctx.list.map(n =>
        n.status === 'done' ? (
          head(ctx, n)
        ) : (
          <Box flexDirection="column" borderStyle="round" borderColor={STATUS[n.status].color} paddingX={1}>
            {head(ctx, n)}
            {fields(ctx, n)}
          </Box>
        ),
      )}
      <Box height={1} marginTop={1}>
        {(['success', 'error'] as const).map((color, i) =>
          widths[i] ? <Box width={widths[i]} height={1} backgroundColor={color} /> : null,
        )}
      </Box>
    </Box>
  )
}

const theme4 = (ctx: Ctx) => {
  const { Box, Text } = ctx.ui

  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap" columnGap={1} marginBottom={1}>
        {ctx.all.map(n => (
          <Box width={3} justifyContent="center" backgroundColor={STATUS[n.status].color}>
            <Text color="inverseText" weight="bold">{STATUS[n.status].glyph}</Text>
          </Box>
        ))}
      </Box>
      {ctx.list.map((n, i) => (
        <Box flexDirection="column" paddingBottom={n.status === 'done' || i === ctx.list.length - 1 ? 0 : 1}>
          {head(ctx, n)}
          {n.status !== 'done' && (
            <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

const theme5 = (ctx: Ctx) => {
  const { Box, Text } = ctx.ui
  const { list } = ctx

  return (
    <Box flexDirection="column">
      {list.map((n, i) => {
        const s = STATUS[n.status]
        const hasFields = n.status !== 'done'
        const last = i === list.length - 1
        const branch = list.length === 1 ? '──' : last ? '╰─' : i === 0 ? '╭─' : '├─'

        return (
          <Box columnGap={1}>
            <Box flexDirection="column" flexShrink={0} width={9}>
              <Text color="inactive" mono>{n.at}  {branch}</Text>
              {hasFields && !last && (
                <Box marginLeft={7} width={1} flexGrow={1} overflow="hidden">
                  {/* Clip to the border's left edge, as tall as the wrapped details. */}
                  <Box position="absolute" top={-1} bottom={-1} width={3} borderStyle="single" borderColor="subtle" />
                </Box>
              )}
            </Box>
            <Box flexDirection="column" flexGrow={1} minWidth={0} paddingBottom={hasFields && !last ? 1 : 0}>
              <Box columnGap={1}>
                <Text color={s.color}>{s.glyph}</Text>
                {title(ctx, n)}
                {n.status === 'unresolved' && tag(ctx, n)}
              </Box>
              {hasFields && (
                <Box flexDirection="column" paddingLeft={2}>{fields(ctx, n)}</Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

const theme7 = (ctx: Ctx) => {
  const { Box, Text } = ctx.ui
  const { t } = ctx
  const col1 = { width: 7, flexShrink: 0 } as const
  const labelCells = Math.max(cells(t.ok), cells(t.failed), cells(t.result))
  const col3 = { width: Math.max(9, labelCells + 1), flexShrink: 0 } as const

  return (
    <Box flexDirection="column">
      <Box>
        <Box {...col1}><Text color="inactive">{t.time}</Text></Box>
        <Box flexGrow={1} minWidth={0}><Text color="inactive">{t.step}</Text></Box>
        <Box {...col3}><Text color="inactive">{t.result}</Text></Box>
      </Box>
      <Text color="subtle" wrap="truncate-end">{'─'.repeat(ctx.width)}</Text>
      {ctx.list.map((n, i) => {
        const s = STATUS[n.status]

        return (
          <Box paddingBottom={n.status === 'done' || i === ctx.list.length - 1 ? 0 : 1}>
            <Box {...col1}><Text color="inactive">{n.at}</Text></Box>
            <Box flexDirection="column" flexGrow={1} minWidth={0}>
              {title(ctx, n)}
              {n.status !== 'done' && fields(ctx, n)}
            </Box>
            <Box {...col3}><Text color={s.color} weight="bold">{label(t, n.status)}</Text></Box>
          </Box>
        )
      })}
    </Box>
  )
}

export const BODIES: Record<number, (ctx: Ctx) => ReturnType<typeof theme1>> = {
  1: theme1,
  2: theme2,
  3: theme3,
  4: theme4,
  5: theme5,
  7: theme7,
}
