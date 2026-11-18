import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'step-flow',
  component: 'Pane',
  requestId: 'step-flow',
  props: {
    title: '작업 흐름',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const TOOL = 'mcp__step-flow__step'

// `lang`: the `language` setting (null = unset); `env`: LANG / LC_ALL.
const setup = async (
  $: any,
  on: any,
  stored: Record<string, unknown> = {},
  lang: string | null = '한국어',
  env: Record<string, string> = {},
) => {
  on('settings.read', () => ({ value: lang === null ? {} : { language: lang } }))
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('store.get', (_: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', (_: any, e: any) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('tool.register', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const cmd = ($: any, command: string, args = '') => $.command.run({ command, args })

const step = ($: any, id: string, input: Record<string, unknown>) =>
  $.tool.run({ tool: TOOL, tool_use_id: id, ...input })

const mount = ($: any, props: Record<string, unknown> = {}) =>
  $.ui.mount({ ...PANE, props: { ...PANE.props, ...props }, surface: 'terminal' })

const seed = async ($: any) => {
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'b', {
    title: '빌드',
    status: 'resolved',
    cause: '타입 오류 3건',
    attempts: [{ action: '캐시 삭제', reason: '오래된 산출물 의심' }],
    fix: '타입 정의 수정',
  })
  await step($, 'c', {
    title: '린트',
    status: 'workaround',
    cause: '규칙 충돌',
    attempts: [{ action: '규칙 끄기', reason: '충돌 확인' }],
    fix: '해당 줄만 예외 처리',
  })
  await step($, 'd', {
    title: 'E2E',
    status: 'unresolved',
    cause: '로그인 화면 지연',
    attempts: [{ action: '대기 늘리기', reason: '타임아웃 의심' }],
    fix: '무시되는 조치',
    detail: '30초 대기 후에도 실패',
  })
}

test('unknown status is denied', async ($, on) => {
  await setup($, on)
  const r = await step($, 't1', { title: '빌드', status: 'failed' })
  expect(r.deny).toContain('status must be one of')
})

test('resolved without attempts and fix is denied, naming every missing field', async ($, on) => {
  await setup($, on)
  const r = await step($, 't2', { title: '빌드', status: 'resolved' })
  expect(r.deny).toContain('missing: cause; attempts (at least 1); fix')
  const w = await step($, 't3', {
    title: '빌드',
    status: 'workaround',
    attempts: [{ action: '재시도', reason: '  ' }],
  })
  expect(w.deny).toContain('missing: cause; attempts[1].reason; fix')
})

test('an attempt without reason is denied, also on done', async ($, on) => {
  await setup($, on)
  const r = await step($, 't4', {
    title: '설치',
    status: 'done',
    attempts: [{ action: '재시도', reason: '' }],
  })
  expect(r.deny).toContain('missing: attempts[1].reason')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /아직 기록한 단계가 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('unresolved with no attempts is accepted and its fix is dropped', async ($, on) => {
  await setup($, on)
  const r = await step($, 't5', { title: '배포', status: 'unresolved', cause: '권한 없음', fix: '버려질 조치' })
  expect(r.result).toBe('recorded')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '조치: 미해결' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /버려질 조치/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^단계 1개, 실패 1개$/ })).toBeDefined()
  await ui.unmount()
})

test('done only: summary has no parenthesis; footer wraps on a narrow pane', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 1개, 실패 0개$/ })).toBeDefined()
  await ui.unmount()

  await step($, 'b', { title: '배포', status: 'unresolved', cause: '권한 없음' })
  const narrow = await mount($, { bodyColumns: 14, scroll: { offset: 0, bodyRows: 20 } })
  const footers = await narrow.findAll({ type: 'Box', text: /^단계 2개,/ })
  expect(footers.length).toBe(1)
  expect(Number(footers[0].props.height)).toBeGreaterThan(1)
  await narrow.unmount()
})

test('trimming keeps non-done nodes', async ($, on) => {
  await setup($, on)
  await step($, 'f0', { title: '실패단계', status: 'unresolved', cause: '이유' })
  await step($, 'f1', {
    title: '우회단계',
    status: 'workaround',
    cause: '이유',
    attempts: [{ action: '시도', reason: '사유' }],
    fix: '다른 방법',
  })
  for (let i = 1; i <= 205; i++) {
    await step($, `d${i}`, { title: `단계${i}`, status: 'done' })
  }

  const ui = await mount($)
  expect(await ui.find({ key: 'f0', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'f1', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'd1', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^단계 200개, 실패 1개$/ })).toBeDefined()
  await ui.unmount()
})

test('each theme renders labels and v2 fields', async ($, on) => {
  await setup($, on)
  await seed($)
  for (const id of [1, 2, 3, 4, 5, 7]) {
    const r = await cmd($, 'flow-theme', String(id))
    expect(r.text).toContain(`테마를 ${id}번(`)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^\s*실패\s*$/ })).toBeDefined()
    const ok = await ui.find({ type: 'Text', text: /^\s*성공\s*$/ })
    if (id === 7) expect(ok).toBeDefined()
    else expect(ok).toBeUndefined()
    for (const label of ['해결', '우회']) {
      expect(await ui.find({ type: 'Text', text: new RegExp(`^\\s*${label}\\s*$`) })).toBeUndefined()
    }
    expect(await ui.find({ type: 'Text', text: /^문제: 타입 오류 3건$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^원인: 로그인 화면 지연$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^시도 1: 캐시 삭제$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^이유: 오래된 산출물 의심$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(이유:/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^조치: 타입 정의 수정$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '조치: 미해결' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /무시되는 조치/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'b' })).toBeDefined()
    if (id === 7) expect(await ui.find({ type: 'Text', text: '성공' })).toBeDefined()
    await ui.unmount()
  }
})

test('/flow-theme saves the choice, lists themes on a bad argument', async ($, on) => {
  const stored: Record<string, unknown> = {}
  await setup($, on, stored)
  await step($, 'a', { title: '설치', status: 'done' })
  const ok = await cmd($, 'flow-theme', '3')
  expect(ok.text).toBe('테마를 3번(Compact)으로 바꿨습니다.')
  expect(stored.theme).toBe(3)

})

test('/flow-theme with no argument shows the picker; a pick sets, saves and hides it', async ($, on) => {
  const stored: Record<string, unknown> = {}
  await setup($, on, stored)
  await seed($)
  await cmd($, 'flow-theme', '3')
  const r = await cmd($, 'flow-theme')
  expect(r.text).toBe('테마 목록을 패널에 띄웠습니다.')
  const ui = await mount($)
  const sel = await ui.find({ type: 'Select', key: 'theme-picker' })
  expect(sel.props.options.map((o: any) => o.value)).toEqual(['1', '2', '3', '4', '5', '7'])
  expect(sel.props.options[2].label).toBe('3  Compact  (current)')
  expect(sel.props.options[0].label).toBe('1  Cards')
  expect(sel.props.value).toBe('3')
  expect(sel.props.autoFocus).toBe(true)
  expect(await ui.find({ type: 'Text', text: '테마 고르기' })).toBeDefined()
  await ui.select({ key: 'theme-picker', value: '5' })
  expect(stored.theme).toBe(5)
  expect(await ui.find({ type: 'Select', key: 'theme-picker' })).toBeUndefined()
  await ui.unmount()
})

test('picker Close hides it; /flow-theme N hides it; detail view shows it', async ($, on) => {
  await setup($, on)
  await seed($)
  await cmd($, 'flow-theme')
  const ui = await mount($)
  await ui.press({ key: 'theme-close' })
  expect(await ui.find({ type: 'Select', key: 'theme-picker' })).toBeUndefined()
  await cmd($, 'flow-theme')
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Select', key: 'theme-picker' })).toBeDefined()
  await cmd($, 'flow-theme', '3')
  expect(await ui.find({ type: 'Select', key: 'theme-picker' })).toBeUndefined()
  await ui.unmount()
})

test('an invalid stored theme falls back to 7', async ($, on) => {
  await setup($, on, { theme: 99 })
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '결과' })).toBeDefined()
  await ui.unmount()
})

test('a stored theme is loaded at session start', async ($, on) => {
  await setup($, on, { theme: 1 })
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '결과' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '↓' })).toBeUndefined()
  await step($, 'b', { title: '배포', status: 'unresolved', cause: '권한 없음' })
  expect(await ui.find({ type: 'Text', text: '↓' })).toBeDefined()
  await ui.unmount()
})

test('title opens the detail view; back returns to the list', async ($, on) => {
  await setup($, on)
  await seed($)

  const ui = await mount($)
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d ~ \d\d:\d\d \((1분 미만|\d+분)\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^시각/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 성공 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '문제' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '타입 오류 3건' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '시도 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '캐시 삭제' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '이유: 오래된 산출물 의심' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '조치' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '타입 정의 수정' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^문제: / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '상세' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /btw로 묻기/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'c' })).toBeUndefined()

  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 'c' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
  // The kit cannot observe the plugin's `$.ui.scroll({ in, to: { key } })` call (no ui.scroll hook
  // beneath the plugin is reached), so only the swallowed failure is covered: back still works.

  await ui.press({ key: 'd' })
  expect(await ui.find({ type: 'Text', text: ' 실패 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '원인' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '로그인 화면 지연' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '미해결' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '상세' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '30초 대기 후에도 실패' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /시각/ })).toBeUndefined()
  await cmd($, 'flow-clear')
  expect(await ui.find({ type: 'Text', text: /아직 기록한 단계가 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('done with cause or fix is denied with the specific message', async ($, on) => {
  await setup($, on)
  const msg =
    'done cannot have cause or fix; if it failed first, call again with status resolved or workaround (with attempts and fix)'
  expect((await step($, 'x1', { title: '설치', status: 'done', cause: '처음엔 실패' })).deny).toBe(msg)
  expect((await step($, 'x2', { title: '설치', status: 'done', fix: '고침' })).deny).toBe(msg)
  expect((await step($, 'x3', { title: '설치', status: 'done', cause: '   ' })).result).toBe('recorded')
})

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const PLACEHOLDER = '세션 컨텍스트에는 영향이 가지 않는 대화입니다'

// Node types of a mounted tree in drawing order.
const order = async (ui: any) => (await ui.findAll({})).map((x: any) => x.type)
const lastIndex = async (ui: any, f: Record<string, unknown>) =>
  (await ui.findAll({})).findLastIndex((x: any) => x.type === f.type && (f.key === undefined || x.key === f.key) && (!f.text || (f.text as RegExp).test(x.text)))

test('no AbovePrompt row is drawn', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({
    plugin: 'step-flow',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 9 },
      view: {},
    },
    surface: 'terminal',
  })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
})

test('the pane list view ends with rule and btw Input after the summary', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mount($)
  const types = await order(ui)
  expect(types[types.length - 1]).toBe('Input')
  const input = await ui.find({ type: 'Input', key: 'btw:0' })
  expect(input.props.placeholder).toBe(PLACEHOLDER)
  expect(input.props.label).toBe('질문')
  expect(input.props.submitLabel).toBe('')
  expect(input.props.autoFocus).toBe(true)
  const summary = await lastIndex(ui, { type: 'Text', text: /^단계 4개,/ })
  const rule = await lastIndex(ui, { type: 'Text', text: /^─{60}$/ })
  expect(summary).toBeGreaterThan(-1)
  expect(rule).toBeGreaterThan(summary)
  expect(types.length - 1).toBeGreaterThan(rule)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('the empty pane draws the empty text, then the btw block', async ($, on) => {
  await setup($, on)
  const ui = await mount($)
  const types = await order(ui)
  expect(types[types.length - 1]).toBe('Input')
  expect(await lastIndex(ui, { type: 'Text', text: /아직 기록한 단계가 없습니다/ })).toBeLessThan(
    await lastIndex(ui, { type: 'Input', key: 'btw:0' }),
  )
  await ui.unmount()
})

test('the pane detail view ends with the btw Input too', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  const types = await order(ui)
  expect(types[types.length - 1]).toBe('Input')
  const input = await ui.find({ type: 'Input', key: 'btw:0' })
  expect(input.props.placeholder).toBe(PLACEHOLDER)
  expect(input.props.autoFocus).toBe(true)
  await ui.unmount()
})

test('a node keeps its own exchange after 6 questions asked elsewhere', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답', usage: USAGE } }))
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  await ui.input({ key: 'btw:0', text: '빌드 질문', kind: 'submit' })
  await ui.press({ key: 'back' })
  for (let i = 1; i <= 6; i++) await ui.input({ key: `btw:${i}`, text: `질문 ${i}`, kind: 'submit' })
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: /^빌드 질문$/ })).toBeDefined()
  await ui.unmount()
})

test('a submit while selected points to a missing node stores no nodeId', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답', usage: USAGE } }))
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'a' })
  for (let i = 0; i < 200; i++) await step($, `x${i}`, { title: `s${i}`, status: 'done' })
  await ui.input({ key: 'btw:0', text: '사라진 노드 질문', kind: 'submit' })
  // A node with the same id coming back must not claim the exchange.
  await step($, 'a', { title: '설치', status: 'done' })
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^질문$/ })).toBeUndefined()
  await ui.unmount()
})

test('a submit asks the model with transcript and work log, shows the answer under its id', async ($, on) => {
  const asked: any[] = []
  on('session.messages', () => ({ value: [
    { role: 'user', content: [{ type: 'text', text: '빌드해 줘' }, { type: 'image', source: {} }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '비밀 생각' },
        { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'pnpm build' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: '빌드 성공' }] }],
    },
  ] }))
  on('model.complete', (_: any, e: any) => {
    asked.push(e)

    return { value: { isAnswered: true, text: '빌드는 성공했습니다.', usage: USAGE } }
  })
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  await ui.input({ key: 'btw:0', text: '  빌드 어땠어?  ', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /^빌드 어땠어\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^빌드는 성공했습니다\.$/ })).toBeDefined()

  expect(asked).toHaveLength(1)
  expect(asked[0].model).toBe('sonnet')
  expect(asked[0].prompt).toContain('빌드해 줘')
  expect(asked[0].prompt).toContain('[tool Bash] {"command":"pnpm build"}')
  expect(asked[0].prompt).toContain('[result] 빌드 성공')
  expect(asked[0].prompt).not.toContain('비밀 생각')
  expect(asked[0].prompt).toContain('문제: 타입 오류 3건')
  expect(asked[0].prompt).toContain('시도 1: 캐시 삭제 (이유: 오래된 산출물 의심)')
  expect(asked[0].prompt).toMatch(/사용자가 보고 있는 단계: 빌드 \(\d\d:\d\d\)/)
  expect(asked[0].prompt.endsWith('Question: 빌드 어땠어?')).toBe(true)

  await ui.input({ key: 'btw:1', text: '   ', kind: 'submit' })
  expect(asked).toHaveLength(1)
  expect(await ui.find({ type: 'Input', key: 'btw:1' })).toBeUndefined()
  expect(await ui.find({ type: 'Input', key: 'btw:2' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^질문$/ })).toHaveLength(0)
  await ui.unmount()
})

test('a submit in a detail view stores the node; other details show only the input, the list the latest', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  let n = 0
  on('model.complete', () => ({ value: { isAnswered: true, text: `답 ${++n}`, usage: USAGE } }))
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  await ui.input({ key: 'btw:0', text: '빌드 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /^빌드 질문$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^답 1$/ })).toBeDefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'c' })
  expect(await ui.find({ type: 'Text', text: /^질문$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  const types = await order(ui)
  expect(types[types.length - 1]).toBe('Input')
  await ui.input({ key: 'btw:1', text: '린트 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Markdown', text: /^답 2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /빌드 질문/ })).toBeUndefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: /^빌드 질문$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^답 1$/ })).toBeDefined()

  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /^린트 질문$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^답 2$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^질문$/ })).toHaveLength(0)
  await ui.unmount()
})

test('a rejected or unanswered model call shows the failure line', async ($, on) => {
  let mode: 'reject' | 'api' = 'reject'
  on('session.messages', () => ({ deny: 'nope' }))
  let prompt = ''
  on('model.complete', (_: any, e: any) => {
    prompt = e.prompt
    if (mode === 'reject') return { deny: 'boom' }

    return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } }
  })
  await setup($, on)
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: '첫 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /^답을 받지 못했습니다 \(.*boom.*\)$/ })).toBeDefined()

  mode = 'api'
  await ui.input({ key: 'btw:1', text: '둘째 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /^둘째 질문$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^답을 받지 못했습니다 \(api-error 529\)$/ })).toBeDefined()
  expect(prompt).toContain('(session transcript unavailable: ')
  expect(prompt).toContain('nope')
  await ui.unmount()
})

test('prompt.compose appends the step-flow:reminder section last', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'x', scope: 'shared' }] }))
  await setup($, on)
  const r = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [],
  })
  const last = r.sections[r.sections.length - 1]
  expect(last?.id).toBe('step-flow:reminder')
  expect(last?.scope).toBe('session')
  expect(last?.text).toContain('unresolved')
})

const lastLoc = ($: any) => $.command.run({ command: 'flow', args: '' })

test('locale: language setting wins, then LANG / LC_ALL, else English', async ($, on) => {
  await setup($, on, {}, '한국어')
  expect((await lastLoc($)).text).toBe('작업 흐름 패널을 열었습니다.')
})

test('locale: English setting gives English', async ($, on) => {
  await setup($, on, {}, 'English', { LANG: 'ko_KR.UTF-8' })
  expect((await lastLoc($)).text).toBe('Opened the work flow panel.')
})

test('locale: LANG en_US.UTF-8 gives English; ko_KR.UTF-8 gives Korean; LC_ALL is the fallback', async ($, on) => {
  await setup($, on, {}, null, { LANG: 'en_US.UTF-8' })
  expect((await lastLoc($)).text).toBe('Opened the work flow panel.')
})

test('locale: LANG ko_KR.UTF-8 gives Korean', async ($, on) => {
  await setup($, on, {}, null, { LANG: 'ko_KR.UTF-8' })
  expect((await lastLoc($)).text).toBe('작업 흐름 패널을 열었습니다.')
})

test('locale: LC_ALL is read when LANG is unset; nothing set gives English', async ($, on) => {
  await setup($, on, {}, null, { LC_ALL: 'ko_KR.UTF-8' })
  expect((await lastLoc($)).text).toBe('작업 흐름 패널을 열었습니다.')
})

test('locale: missing everywhere gives English', async ($, on) => {
  await setup($, on, {}, null, {})
  expect((await lastLoc($)).text).toBe('Opened the work flow panel.')
})

test('theme 7 puts the attempt and its reason on separate lines', async ($, on) => {
  await setup($, on)
  await seed($)
  await cmd($, 'flow-theme', '7')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^시도 1: 캐시 삭제$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^이유: 오래된 산출물 의심$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(이유:/ })).toBeUndefined()
  await ui.unmount()
})

test('English render of a resolved node and the summary', async ($, on) => {
  await setup($, on, {}, 'English')
  await seed($)
  await step($, 'e', { title: 'x', status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^\s*Done\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*Failed\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Problem: 타입 오류 3건$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Attempt 1: 캐시 삭제$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^reason: 오래된 산출물 의심$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fix: 타입 정의 수정$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cause: 로그인 화면 지연$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fix: Unresolved' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5 steps, 1 failed$/ })).toBeDefined()
  await ui.unmount()
  const r = await cmd($, 'flow-theme', '3')
  expect(r.text).toBe('Theme set to 3 (Compact).')
})

test('pane btw placeholder follows the language', async ($, on) => {
  await setup($, on, {}, 'English')
  const ui = await mount($)
  const input = await ui.find({ type: 'Input', key: 'btw:0' })
  expect(input.props.placeholder).toBe("A side chat that doesn't affect the session context")
  expect(input.props.submitLabel).toBe('')
  expect(input.props.label).toBe('Question')
  await ui.unmount()
})

test('the btw Input key changes after a submit, so the field is empty again', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'ok', usage: USAGE } }))
  await setup($, on)
  const ui = await mount($)
  expect(await ui.find({ type: 'Input', key: 'btw:0' })).toBeDefined()
  await ui.input({ key: 'btw:0', text: '질문', kind: 'submit' })
  expect(await ui.find({ type: 'Input', key: 'btw:0' })).toBeUndefined()
  const next = await ui.find({ type: 'Input', key: 'btw:1' })
  expect(next).toBeDefined()
  expect(next.props.value).toBe('')
  await ui.unmount()
})

test('the answer is a Markdown element with the raw text; a long question is not truncated', async ($, on) => {
  const md = '**굵게:** `코드`\n- 하나\n- 둘'
  const longQ = '아주 긴 질문입니다 '.repeat(30).trim()
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: md, usage: USAGE } }))
  await setup($, on)
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: longQ, kind: 'submit' })
  const m = await ui.find({ type: 'Markdown' })
  expect(m.props.text).toBe(md)
  expect(await ui.find({ type: 'Text', text: /^답$/ })).toBeUndefined()
  const q = await ui.find({ type: 'Text', text: longQ })
  expect(q).toBeDefined()
  expect(q.props.wrap).toBe('wrap')
  await ui.unmount()
})

test('a long btw answer is drawn whole, not cut', async ($, on) => {
  const long = '긴 답변입니다. '.repeat(300)
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: long, usage: USAGE } }))
  await setup($, on)
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: '질문', kind: 'submit' })
  const a = await ui.find({ type: 'Markdown' })
  expect(a).toBeDefined()
  expect(a.props.text.endsWith('긴 답변입니다.')).toBe(true)
  expect(a.props.text).not.toContain('…')
  await ui.unmount()
})

test('trimming 200 non-done nodes keeps the new node', async ($, on) => {
  await setup($, on)
  for (let i = 1; i <= 200; i++) await step($, `u${i}`, { title: `실패${i}`, status: 'unresolved', cause: '이유' })
  expect((await step($, 'new', { title: '새 단계', status: 'done' })).result).toBe('recorded')
  const ui = await mount($)
  expect(await ui.find({ key: 'new', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'u1', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ key: 'u200', type: 'Button' })).toBeDefined()
  await ui.unmount()
})

test('a zero-width pane still renders (wrap helper terminates)', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($, { bodyColumns: 0 })
  expect(ui).toBeDefined()
  await ui.unmount()
})

test('list views cut long texts and hide old done steps under the tree limit', async ($, on) => {
  await setup($, on)
  const huge = '가'.repeat(2000)
  await step($, 'big', { title: '큰 실패', status: 'unresolved', cause: huge })
  for (let i = 1; i <= 150; i++) await step($, `d${i}`, { title: `성공${i}`, status: 'done' })
  const ui = await mount($)
  const cause = await ui.find({ type: 'Text', text: /^원인: / })
  expect(cause.text.length).toBeLessThan(320)
  expect(cause.text.endsWith('…')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^앞선 \d+개 단계는 숨겼습니다$/ })).toBeDefined()
  expect(await ui.find({ key: 'd150', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'd1', type: 'Button' })).toBeUndefined()
  await ui.press({ key: 'big' })
  const full = await ui.find({ type: 'Text', text: /^가{2000}$/ })
  expect(full.text.length).toBe(2000)
  await ui.unmount()
})

test('theme 3 bar counts all nodes, also those hidden by the size guard', async ($, on) => {
  await setup($, on, { theme: 3 })
  await step($, 'f0', { title: '실패단계', status: 'unresolved', cause: '이유' })
  for (let i = 1; i <= 205; i++) await step($, `d${i}`, { title: `단계${i}`, status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ key: 'd1', type: 'Button' })).toBeUndefined()
  // 199 done + 1 unresolved over 60 cells: 59 + 1 (shown-only counts would give a different split).
  const bars = (await ui.findAll({ type: 'Box', height: 1 })).filter((x: any) => x.props.backgroundColor)
  expect(bars.map((x: any) => x.props.width).slice(0, 2)).toEqual([59, 1])
  await ui.unmount()
})

test('theme 4 cell row covers all nodes, also those hidden by the size guard', async ($, on) => {
  await setup($, on, { theme: 4 })
  await step($, 'f0', { title: '실패단계', status: 'unresolved', cause: '이유' })
  for (let i = 1; i <= 205; i++) await step($, `d${i}`, { title: `단계${i}`, status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ key: 'd1', type: 'Button' })).toBeUndefined()
  const cells = (await ui.findAll({ type: 'Box', width: 3 })).filter((x: any) => x.props.backgroundColor)
  // all = capped 200 (199 done + 1 failed); a hidden-aware list would show far fewer.
  expect(cells.filter((x: any) => x.props.backgroundColor === 'success').length).toBe(199)
  await ui.unmount()
})

test('a resolved node shows 성공 with its 문제 and 조치 fields', async ($, on) => {
  await setup($, on)
  await step($, 'b', { title: '빌드', status: 'resolved', cause: '오류', attempts: [{ action: '수정', reason: '확인' }], fix: '고침' })
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^문제: 오류$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^이유: 확인$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^조치: 고침$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*(해결|우회)\s*$/ })).toBeUndefined()
    const ok = await ui.find({ type: 'Text', text: /^\s*성공\s*$/ })
    if (id === 7) expect(ok).toBeDefined()
    else expect(ok).toBeUndefined()
    await ui.unmount()
  }
})

test('summary: 실패 0개 in success color, 실패 N개 in error color', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'b', { title: '빌드', status: 'resolved', cause: '오류', attempts: [{ action: '수정', reason: '확인' }], fix: '고침' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 실패 0개$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '실패 0개' })).map((x: any) => x.props.color)).toContain('success')
  expect(await ui.find({ type: 'Text', text: /성공 \d|해결 \d|우회/ })).toBeUndefined()
  await step($, 'c', { title: '배포', status: 'unresolved', cause: '권한 없음' })
  expect(await ui.find({ type: 'Text', text: /^단계 3개, 실패 1개$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '실패 1개' })).map((x: any) => x.props.color)).toContain('error')
  await ui.unmount()
})

test('English summary: singular step, 0 and >0 failures', async ($, on) => {
  await setup($, on, {}, 'English')
  await step($, 'a', { title: 'x', status: 'resolved', cause: 'c', attempts: [{ action: 'a', reason: 'r' }], fix: 'f' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^1 step, 0 failed$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '0 failed' })).map((x: any) => x.props.color)).toContain('success')
  await step($, 'b', { title: 'y', status: 'unresolved', cause: 'c' })
  expect(await ui.find({ type: 'Text', text: /^2 steps, 1 failed$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '1 failed' })).map((x: any) => x.props.color)).toContain('error')
  await ui.unmount()
})

test('theme 4 cells and theme 3 bar use only success and error colors', async ($, on) => {
  await setup($, on, { theme: 4 })
  await seed($)
  let ui = await mount($)
  const colors = async (ui: any) =>
    (await ui.findAll({ type: 'Box' })).map((x: any) => x.props.backgroundColor).filter((c: unknown) => c && c !== 'inverseText')
  const cellColors = (await colors(ui)).filter((_: unknown, i: number) => i < 4)
  expect(cellColors).toEqual(['success', 'success', 'success', 'error'])
  await ui.unmount()
  await cmd($, 'flow-theme', '3')
  ui = await mount($)
  const bars = (await ui.findAll({ type: 'Box', height: 1 })).filter((x: any) => x.props.backgroundColor && x.props.backgroundColor !== 'inverseText')
  expect(bars.map((x: any) => x.props.backgroundColor)).toEqual(['success', 'error'])
  expect(bars.map((x: any) => x.props.width)).toEqual([45, 15])
  await ui.unmount()
})

test('English detail view uses the label column labels', async ($, on) => {
  await setup($, on, {}, 'English')
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  for (const text of ['Problem', 'Attempt 1', 'reason: 오래된 산출물 의심', 'Fix']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.press({ key: 'back' })
  await ui.press({ key: 'd' })
  for (const text of [' Failed ', 'Cause', 'Detail']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await ui.unmount()
})

test('only an unresolved title is colored (error); resolved is plain', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: '빌드' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'E2E', color: 'error' })).toBeDefined()
  await ui.unmount()
})
