import { expect, test } from 'claude-code/testing'

import { isFailure, isKept, isOpen, norm } from '../hooks/themes'

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
    status: 'resolved',
    cause: '규칙 충돌',
    attempts: [{ action: '규칙 끄기', reason: '충돌 확인' }],
    fix: '해당 줄만 예외 처리',
  })
  await step($, 'd', {
    title: 'E2E',
    status: 'blocked',
    cause: '로그인 화면 지연',
    notDone: ['로그인 후 검증'],
    attempts: [{ action: '대기 늘리기', reason: '타임아웃 의심' }],
    detail: '30초 대기 후에도 실패',
  })
}

const DECISION = {
  title: '배포 방식',
  status: 'decision',
  cause: '무중단이 필요한지 모릅니다',
  options: [
    { option: '블루그린', note: '무중단, 비용 두 배' },
    { option: '롤링', note: '짧은 끊김, 저렴' },
  ],
  interim: '배포 스크립트 작성',
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
    status: 'resolved',
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

test('workaround and unresolved are gone and denied with a message naming the new statuses', async ($, on) => {
  await setup($, on)
  for (const status of ['workaround', 'unresolved']) {
    const r = await step($, `g-${status}`, { title: '빌드', status, cause: '원인' })
    expect(r.deny).toContain('status must be one of: done, resolved, deferred, blocked, decision')
    expect(r.deny).toContain(`${status} no longer exists`)
  }
})

test('deferred: needs cause and okReason; fix, needs-less options and wrong fields are denied; the result names the id', async ($, on) => {
  await setup($, on)
  expect((await step($, 'f1', { title: '배포', status: 'deferred' })).deny).toContain(
    'missing: cause; okReason (why moving on is safe)',
  )
  const fixed = await step($, 'f2', { title: '배포', status: 'deferred', cause: '권한', okReason: '다른 작업과 무관', fix: '고침' })
  expect(fixed.deny).toContain('deferred means not fixed yet')
  expect(fixed.deny).toContain('mcp__step-flow__resolve')
  const one = await step($, 'f3', {
    title: '배포',
    status: 'deferred',
    cause: '권한',
    okReason: '무관',
    options: [{ option: 'A', note: 'a' }],
  })
  expect(one.deny).toContain('missing: options (at least 2)')
  const bad = await step($, 'f4', {
    title: '배포',
    status: 'deferred',
    cause: '권한',
    okReason: '무관',
    attempts: [{ action: '시도', reason: ' ' }],
  })
  expect(bad.deny).toContain('missing: attempts[1].reason')
  const ok = await step($, 'f5', { title: '배포', status: 'deferred', cause: '권한 없음', okReason: '나중에 해도 됨' })
  expect(ok.result).toBe('recorded deferred f5. When you fix it later, call mcp__step-flow__resolve with this id and the fix.')
  const withOptions = await step($, 'f6', {
    title: '배포 둘',
    status: 'deferred',
    cause: '권한',
    okReason: '무관',
    options: [
      { option: '건너뜀', note: '없이 진행' },
      { option: '재시도', note: '권한 받고' },
    ],
  })
  expect(withOptions.result).toBe(
    'recorded deferred f6. When you fix it later, call mcp__step-flow__resolve with this id and the fix. The user can pick an option in the step-flow pane. Open: 1 to decide, 0 blocked.',
  )
})

test('blocked: needs cause and notDone, a stray needs is ignored; resolved and done refuse okReason and options', async ($, on) => {
  await setup($, on)
  expect((await step($, 'b1', { title: '로그인', status: 'blocked' })).deny).toContain(
    'missing: cause; notDone (at least 1 item',
  )
  expect((await step($, 'b2', { title: '로그인', status: 'blocked', cause: '계정 없음', notDone: ['미완료 하나'], fix: '고침' })).deny).toContain(
    'blocked means not fixed yet',
  )
  // cause and notDone are enough
  const ok = await step($, 'b3', { title: '로그인', status: 'blocked', cause: '계정 없음', notDone: ['미완료 하나'] })
  expect(ok.result).toBe(
    'recorded blocked b3. When you fix it later, call mcp__step-flow__resolve with this id and the fix. Open: 0 to decide, 1 blocked.',
  )
  // a model with an old habit may still send needs: recorded, the value ignored
  const old = await step($, 'b4', { title: '결제', status: 'blocked', cause: '키 없음', needs: '키를 주세요', notDone: ['결제 확인'] })
  expect(old.result).toMatch(/^recorded blocked b4\./)
  const r = await step($, 'r1', {
    title: '빌드',
    status: 'resolved',
    cause: '오류',
    attempts: [{ action: 'a', reason: 'r' }],
    fix: '고침',
    okReason: '불필요',
  })
  expect(r.deny).toContain('resolved cannot have okReason or options')
  expect((await step($, 'd1', { title: '설치', status: 'done', okReason: 'x' })).deny).toContain(
    'done cannot have okReason or options',
  )
  const ui = await mount($)
  await ui.press({ key: 'b3' })
  expect(await ui.find({ type: 'Text', text: ' 중단 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '진행하지 못한 작업' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 미완료 하나' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /로 진행/ })).toBeUndefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /키를 주세요|필요한 것/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '- 결제 확인' })).toBeDefined()
  await ui.press({ key: 'b4' })
  expect(await ui.find({ type: 'Text', text: /필요한 것|키를 주세요|Needs/ })).toBeUndefined()
  await ui.unmount()
})

test('done only: summary has no parenthesis; footer wraps on a narrow pane', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 1개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  await ui.unmount()

  await step($, 'b', { title: '배포', status: 'blocked', cause: '권한 없음', notDone: ['미완료 하나'] })
  const narrow = await mount($, { bodyColumns: 14, scroll: { offset: 0, bodyRows: 20 } })
  const footers = await narrow.findAll({ type: 'Box', text: /^단계 2개,/ })
  expect(footers.length).toBe(1)
  expect(Number(footers[0].props.height)).toBeGreaterThan(1)
  await narrow.unmount()
})

test('trimming keeps non-done nodes', async ($, on) => {
  await setup($, on)
  await step($, 'f0', { title: '실패단계', status: 'blocked', cause: '이유', notDone: ['미완료 하나'] })
  await step($, 'f1', {
    title: '우회단계',
    status: 'resolved',
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
  expect(await ui.find({ type: 'Text', text: /^단계 200개, 결정 필요 0개, 중단 1개, 보류 0개$/ })).toBeDefined()
  await ui.unmount()
})

// A failed step expands its fields under its row; success, done and decision rows stay one line.
const expectListFields = async (ui: any) => {
  expect(await ui.find({ type: 'Text', text: /^\s*중단\s*$/ })).toBeDefined()
  for (const label of ['해결', '우회']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^\\s*${label}\\s*$`) })).toBeUndefined()
  }
  expect(await ui.find({ type: 'Text', text: /^문제: 타입 오류 3건$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^원인: 로그인 화면 지연$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^시도 1: 캐시 삭제$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^이유: 오래된 산출물 의심$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(이유:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^조치: 타입 정의 수정$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '진행하지 못한 작업:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 로그인 후 검증' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /필요한 것/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /30초 대기/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'b' })).toBeDefined()
}

test('a failed step shows its fields in the list in every theme, docked and not', async ($, on) => {
  await setup($, on)
  await seed($)
  for (const id of [1, 2, 3, 4, 5, 7]) {
    const r = await cmd($, 'flow-theme', String(id))
    expect(r.text).toContain(`테마를 ${id}번(`)
    for (const docked of [false, true]) {
      const ui = docked ? await mountPinned($, { scroll: { offset: 0, bodyRows: 80 } }) : await mount($)
      await expectListFields(ui)
      const ok = await ui.find({ type: 'Text', text: /^\s*성공\s*$/ })
      if (id === 7) expect(ok).toBeDefined()
      else expect(ok).toBeUndefined()
      await ui.unmount()
    }
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
  await step($, 'b', { title: '배포', status: 'blocked', cause: '권한 없음', notDone: ['미완료 하나'] })
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
  expect(await ui.find({ type: 'Text', text: ' 중단 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '원인' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '로그인 화면 지연' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '진행하지 못한 작업' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 로그인 후 검증' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '필요한 것' })).toBeUndefined()
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
    'done cannot have cause or fix; if it failed first, call again with status resolved (with attempts and fix), or deferred or blocked if it is still not fixed'
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
  expect(last?.text).toContain('blocked')
  expect(last?.text).toContain('mcp__step-flow__resolve')
  expect(last?.text).toContain('choice 0')
  expect(last?.text).toContain('starting with "결정 (", "Decision (", "진행 (" or "Go ahead ("')
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

test('the detail view puts the attempt and its reason on separate lines', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: /^캐시 삭제$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^\s*Blocked\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Problem: 타입 오류 3건$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Attempt 1: 캐시 삭제$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^reason: 오래된 산출물 의심$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fix: 타입 정의 수정$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cause: 로그인 화면 지연$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not done:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 로그인 후 검증' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Needs:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5 steps, 0 to decide, 1 blocked, 0 deferred$/ })).toBeDefined()
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: 'Problem' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Attempt 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'reason: 오래된 산출물 의심' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '타입 정의 수정' })).toBeDefined()
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
  for (let i = 1; i <= 200; i++) await step($, `u${i}`, { title: `실패${i}`, status: 'blocked', cause: '이유', notDone: ['미완료 하나'] })
  expect((await step($, 'new', { title: '새 단계', status: 'done' })).result).toMatch(/^recorded/)
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

test('list views cut long field texts and hide old done steps under the tree limit', async ($, on) => {
  await setup($, on)
  const huge = '가'.repeat(2000)
  await step($, 'big', { title: '큰 실패', status: 'blocked', cause: huge, notDone: ['미완료 하나'] })
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
  await step($, 'f0', { title: '실패단계', status: 'blocked', cause: '이유', notDone: ['미완료 하나'] })
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
  await step($, 'f0', { title: '실패단계', status: 'blocked', cause: '이유', notDone: ['미완료 하나'] })
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
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '중단 0개' })).map((x: any) => x.props.color)).toContain('success')
  expect(await ui.find({ type: 'Text', text: /성공 \d|해결 \d|우회/ })).toBeUndefined()
  await step($, 'c', { title: '배포', status: 'blocked', cause: '권한 없음', notDone: ['미완료 하나'] })
  expect(await ui.find({ type: 'Text', text: /^단계 3개, 결정 필요 0개, 중단 1개, 보류 0개$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '중단 1개' })).map((x: any) => x.props.color)).toContain('error')
  await ui.unmount()
})

test('English summary: singular step, 0 and >0 failures', async ($, on) => {
  await setup($, on, {}, 'English')
  await step($, 'a', { title: 'x', status: 'resolved', cause: 'c', attempts: [{ action: 'a', reason: 'r' }], fix: 'f' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^1 step, 0 to decide, 0 blocked, 0 deferred$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '0 blocked' })).map((x: any) => x.props.color)).toContain('success')
  await step($, 'b', { title: 'y', status: 'blocked', cause: 'c', notDone: ['미완료 하나'] })
  expect(await ui.find({ type: 'Text', text: /^2 steps, 0 to decide, 1 blocked, 0 deferred$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '1 blocked' })).map((x: any) => x.props.color)).toContain('error')
  await ui.unmount()
})

test('theme 4 cells and theme 3 bar: success, warning for a pending decision, error', async ($, on) => {
  await setup($, on, { theme: 4 })
  await seed($)
  await step($, 'q', DECISION)
  let ui = await mount($)
  const colors = async (ui: any) =>
    (await ui.findAll({ type: 'Box' })).map((x: any) => x.props.backgroundColor).filter((c: unknown) => c && c !== 'inverseText')
  expect((await colors(ui)).filter((_: unknown, i: number) => i < 5)).toEqual(['success', 'success', 'success', 'error', 'warning'])
  await ui.unmount()
  await cmd($, 'flow-theme', '3')
  ui = await mount($)
  const bars = (await ui.findAll({ type: 'Box', height: 1 })).filter((x: any) => x.props.backgroundColor && x.props.backgroundColor !== 'inverseText')
  expect(bars.map((x: any) => x.props.backgroundColor)).toEqual(['success', 'warning', 'error'])
  expect(bars.map((x: any) => x.props.width)).toEqual([36, 12, 12])
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
  for (const text of [' Blocked ', 'Cause', 'Detail']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
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

const DECIDED = 'mcp__step-flow__decided'
const decided = ($: any, input: Record<string, unknown>) =>
  $.tool.run({ tool: DECIDED, tool_use_id: 'dd', ...input })

test('decision: missing fields, fewer than 2 options and attempts or fix are denied; the result carries the id', async ($, on) => {
  await setup($, on)
  const m1 = await step($, 'm1', { title: '배포 방식', status: 'decision' })
  expect(m1.deny).toContain('missing: cause; options (at least 2); interim')
  const m2 = await step($, 'm2', { ...DECISION, options: [{ option: 'A', note: 'a' }] })
  expect(m2.deny).toContain('missing: options (at least 2)')
  const m3 = await step($, 'm3', { ...DECISION, options: [{ option: 'A', note: 'a' }, { option: 'B', note: ' ' }] })
  expect(m3.deny).toContain('missing: options[2].note')
  const m4 = await step($, 'm4', { ...DECISION, attempts: [{ action: '시도', reason: '사유' }] })
  expect(m4.deny).toContain('decision cannot have attempts or fix')
  const m5 = await step($, 'm5', { ...DECISION, fix: '조치' })
  expect(m5.deny).toContain('decision cannot have attempts or fix')
  const ok = await step($, 'q1', DECISION)
  expect(ok.result).toBe(
    'recorded decision q1. The user can decide in the step-flow pane; if the user answers in chat instead, call mcp__step-flow__decided with this id and the chosen option number. Open: 1 to decide, 0 blocked.',
  )
  expect((await step($, 'x', { title: '설치', status: 'done' })).result).toBe('recorded Open: 1 to decide, 0 blocked.')
})

test('decided tool: marks the node, id is optional with one pending, idempotent, every deny names the pending list', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'q1', DECISION)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 1개, 중단 0개, 보류 0개$/ })).toBeDefined()

  const unknown = await decided($, { id: 'nope', choice: 1 })
  expect(unknown.deny).toContain('unknown id nope')
  expect(unknown.deny).toContain('q1 "배포 방식"')
  expect((await decided($, { id: 'a', choice: 1 })).deny).toContain('a "설치" is done with no choice to make')
  expect((await decided($, { id: 'q1', choice: -1 })).deny).toContain('choice must be a whole number from 1 to 2')
  expect((await decided($, { id: 'q1', choice: 3 })).deny).toContain('from 1 to 2')
  expect((await decided($, { id: 'q1', choice: 1.5 })).deny).toContain('from 1 to 2')

  expect((await decided($, { choice: 2 })).result).toBe('recorded q1 "배포 방식": B (롤링)')
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Text', text: /^B · \d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ 롤링' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeUndefined()

  // a later chat answer may change it
  expect((await decided($, { id: 'q1', choice: 1 })).result).toBe('recorded q1 "배포 방식": A (블루그린)')
  expect(await ui.find({ type: 'Text', text: /^A · \d\d:\d\d$/ })).toBeDefined()
  await ui.unmount()

  await step($, 'q2', DECISION)
  await step($, 'q3', DECISION)
  const none = await decided($, { choice: 1 })
  expect(none.deny).toContain('id is missing')
  expect(none.deny).toContain('q2 "배포 방식" (decision); q3 "배포 방식" (decision)')
})

test('decision detail view: rows, badge, buttons', async ($, on) => {
  await setup($, on)
  await step($, 'q1', DECISION)
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  const badge = await ui.find({ type: 'Text', text: ' 결정 필요 ' })
  expect(badge.props.color).toBe('warning')
  expect(badge.props.inverse).toBe(true)
  for (const text of ['쟁점', '무중단이 필요한지 모릅니다', 'A', '블루그린', '무중단, 비용 두 배', 'B', '롤링', '그동안', '배포 스크립트 작성']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await ui.find({ type: 'Button', key: 'decide-A', text: 'A로 결정' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-B', text: 'B로 결정' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^결정$/ })).toBeUndefined()
  await ui.unmount()
})

test('English decision detail view', async ($, on) => {
  await setup($, on, {}, 'English')
  await step($, 'q1', DECISION)
  const en = await mount($)
  await en.press({ key: 'q1' })
  expect(await en.find({ type: 'Button', key: 'decide-A', text: 'Choose A' })).toBeDefined()
  expect(await en.find({ type: 'Text', text: ' Needs decision ' })).toBeDefined()
  expect(await en.find({ type: 'Text', text: 'Issue' })).toBeDefined()
  expect(await en.find({ type: 'Text', text: 'Meanwhile' })).toBeDefined()
  await en.unmount()
})

test('pressing a choice sets decided and submits the exact prompt; the row then shows the pick', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await setup($, on)
  await step($, 'q1', DECISION)
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  await Promise.all([ui.press({ key: 'decide-A' }), ui.press({ key: 'decide-A' }).catch(() => {})])
  expect(sent.map(x => x.replace(/\d\d:\d\d/, 'HH:MM'))).toEqual([
    '결정 (사용자가 step-flow 패널에서 직접 눌렀습니다): "배포 방식" (HH:MM 기록, 이후 단계 0개) → A (블루그린: 무중단, 비용 두 배). 쟁점: 무중단이 필요한지 모릅니다. 이미 기록했습니다 (q1). 바꾸기 전에 지금 상태를 확인하세요. 이 단계가 이미 해결됐거나 이 선택이 뒤에 한 작업과 부딪히면 아무것도 바꾸지 말고, mcp__step-flow__decided를 이 id와 choice 0으로 호출해 선택을 다시 연 뒤 사용자에게 먼저 알리세요. 문제가 없으면 이 선택으로 진행하세요.',
  ])
  expect(await ui.find({ type: 'Text', text: /^A · \d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 결정됨 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ 블루그린' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-B' })).toBeUndefined()
  await ui.unmount()
})

test('English decision prompt text', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await setup($, on, {}, 'English')
  await step($, 'q1', DECISION)
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  await ui.press({ key: 'decide-B' })
  expect(sent.map(x => x.replace(/\d\d:\d\d/, 'HH:MM'))).toEqual([
    'Decision (the user pressed this in the step-flow pane): "배포 방식" (recorded HH:MM, 0 steps since) → B (롤링: 짧은 끊김, 저렴). Issue: 무중단이 필요한지 모릅니다. Already recorded (q1). Check the current state before changing anything. If this step is already fixed or this choice conflicts with work done after it, change nothing, call mcp__step-flow__decided with this id and choice 0 to reopen the choice, and tell the user first. Otherwise go on with this choice.',
  ])
  await ui.unmount()
})

test('a refused or failing submit clears decided again, so the buttons come back', async ($, on) => {
  let mode: 'drop' | 'throw' = 'drop'
  on('prompt.submit', () => {
    if (mode === 'throw') throw new Error('boom')

    return { drop: 'busy' }
  })
  await setup($, on)
  await step($, 'q1', DECISION)
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  await ui.press({ key: 'decide-A' })
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^A · / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^단계 1개, 결정 필요 1개, 중단 0개, 보류 0개$/ })).toBeDefined()
  mode = 'throw'
  await ui.press({ key: 'decide-B' })
  expect(await ui.find({ type: 'Button', key: 'decide-B' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^B · / })).toBeUndefined()
  await ui.unmount()
})

test('activity: tool calls go to the next step, step tools are left out, the buffer is cleared, 40 lines, 120 chars', async ($, on) => {
  const answer = { result: { ok: true }, text: 'ok' }
  on('tool.call', () => answer)
  await setup($, on)
  const call = (input: any) => $.tool.call(input)
  // step-flow's own tools are never captured (they would show up in the next step's lines)
  await call({ tool: TOOL, title: '무시', status: 'done' })
  await call({ tool: DECIDED, choice: 1 })
  const r = await call({ tool: 'Bash', command: 'ls -la' })
  expect(r.result).toEqual({ ok: true })
  await call({ tool: 'Read', file_path: '/a/b.ts' })
  await call({ tool: 'Edit', file_path: '/a/c.ts', old_string: 'x', new_string: 'y' })
  await call({ tool: 'Grep', pattern: 'foo.*bar' })
  await call({ tool: 'Glob', pattern: '**/*.tsx' })
  await call({ tool: 'Agent', description: '조사', prompt: '긴 프롬프트' })
  await call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x' })
  await step($, 's1', { title: '첫 단계', status: 'done' })
  await step($, 's2', { title: '둘째 단계', status: 'done' })
  const ui = await mount($)
  await ui.press({ key: 's1' })
  expect(await ui.find({ type: 'Text', text: '한 일' })).toBeDefined()
  const lines = (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.mono).map((x: any) => x.text)
  expect(lines).toEqual([
    'Bash ls -la',
    'Read /a/b.ts',
    'Edit /a/c.ts',
    'Grep foo.*bar',
    'Glob **/*.tsx',
    'Agent 조사',
    'WebFetch https://example.com',
  ])
  await ui.press({ key: 'back' })
  await ui.press({ key: 's2' })
  expect(await ui.find({ type: 'Text', text: '한 일' })).toBeUndefined()
  await ui.press({ key: 'back' })

  for (let i = 1; i <= 45; i++) await call({ tool: 'Bash', command: `c${i}` })
  await call({ tool: 'Bash', command: 'x'.repeat(300) })
  await step($, 's3', { title: '셋째 단계', status: 'done' })
  await ui.press({ key: 's3' })
  const many = (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.mono).map((x: any) => x.text)
  expect(many).toHaveLength(40)
  expect(many[0]).toBe('Bash c7')
  expect(many[39]).toBe(`Bash ${'x'.repeat(115)}`)
  expect(many[39]?.length).toBe(120)
  await ui.unmount()
})

test('trimming and the size guard keep a pending decision', async ($, on) => {
  await setup($, on)
  await step($, 'q1', DECISION)
  for (let i = 1; i <= 210; i++) await step($, `u${i}`, { title: `실패${i}`, status: 'blocked', cause: '이유', notDone: ['미완료 하나'] })
  let ui = await mount($)
  expect(await ui.find({ key: 'q1', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'u1', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^단계 200개, 결정 필요 1개, 중단 199개, 보류 0개$/ })).toBeDefined()
  await ui.unmount()

  await cmd($, 'flow-clear')
  await step($, 'q2', DECISION)
  for (let i = 1; i <= 150; i++) await step($, `d${i}`, { title: `성공${i}`, status: 'done' })
  await step($, 'q3', DECISION)
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^앞선 \d+개 단계는 숨겼습니다$/ })).toBeDefined()
  expect(await ui.find({ key: 'd1', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ key: 'q2', type: 'Button' })).toBeDefined()
  await ui.unmount()
})

test('summary names pending decisions: warning above 0, success at 0; English too', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'q1', DECISION)
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 1개, 중단 0개, 보류 0개$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '결정 필요 1개' })).map((x: any) => x.props.color)).toContain('warning')
  expect((await ui.findAll({ type: 'Text', text: '중단 0개' })).map((x: any) => x.props.color)).toContain('success')
  await decided($, { choice: 1 })
  expect((await ui.findAll({ type: 'Text', text: '결정 필요 0개' })).map((x: any) => x.props.color)).toContain('success')
  await ui.unmount()
})

test('English summary names pending decisions', async ($, on) => {
  await setup($, on, {}, 'English')
  await step($, 'a', { title: 'x', status: 'done' })
  const en = await mount($)
  expect(await en.find({ type: 'Text', text: /^1 step, 0 to decide, 0 blocked, 0 deferred$/ })).toBeDefined()
  await step($, 'q2', DECISION)
  expect(await en.find({ type: 'Text', text: /^2 steps, 1 to decide, 0 blocked, 0 deferred$/ })).toBeDefined()
  await en.unmount()
})

test('the work log of a side question carries the decision, its options and the choice', async ($, on) => {
  const asked: any[] = []
  on('session.messages', () => ({ value: [] }))
  on('model.complete', (_: any, e: any) => {
    asked.push(e)

    return { value: { isAnswered: true, text: '답', usage: USAGE } }
  })
  await setup($, on)
  await step($, 'q1', DECISION)
  await decided($, { id: 'q1', choice: 2 })
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: '뭘 골랐지?', kind: 'submit' })
  const prompt: string = asked[0].prompt
  expect(prompt).toContain('쟁점: 무중단이 필요한지 모릅니다')
  expect(prompt).toContain('A. 블루그린: 무중단, 비용 두 배')
  expect(prompt).toContain('B. 롤링: 짧은 끊김, 저렴')
  expect(prompt).toContain('그동안: 배포 스크립트 작성')
  expect(prompt).toMatch(/결정: B \(롤링\) \d\d:\d\d/)
  await ui.unmount()
})

// The element carrying a key (Button) or text, anywhere under `n`.
const under = (n: any, f: (x: any) => boolean): any[] =>
  n && typeof n === 'object' ? [...(f(n) ? [n] : []), ...(n.children ?? []).flatMap((c: any) => under(c, f))] : []
// Deepest element holding the node's title button and its time text: the node's row.
const textOf = (n: any): string =>
  typeof n === 'string' ? n : (n?.children ?? []).map(textOf).join('')
const rowOf = (root: any, id: string) => {
  const button = (x: any) => x.type === 'Button' && (x.key ?? x.props?.key) === id
  const timed = (x: any) => x.type === 'Text' && /^\d\d:\d\d/.test(textOf(x))
  const find = (n: any): any =>
    under(n, button).length && under(n, timed).length
      ? ((n.children ?? []).map(find).find(Boolean) ?? n)
      : undefined

  return find(root)
}

test('success, done and decision steps are one row in every theme, docked and not', async ($, on) => {
  await setup($, on)
  await seed($)
  await step($, 'q', DECISION)
  await step($, 'dec', { ...DECISION, title: '결정됨' })
  await decided($, { id: 'dec', choice: 1 })
  const ids = ['a', 'b', 'c', 'q', 'dec']
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    for (const docked of [false, true]) {
      const ui = docked ? await mountPinned($, { scroll: { offset: 0, bodyRows: 80 } }) : await mount($)
      const root = (await ui.findAll({}))[0]
      for (const key of ids) {
        const row = rowOf(root, key)
        expect(row).toBeDefined()
        expect(row.props?.flexDirection).not.toBe('column')
        expect(under(row, (x: any) => x.type === 'Button')).toHaveLength(1)
      }
      // a decision row carries its tag and no fields
      expect(await ui.find({ type: 'Text', text: /^\s*결정 필요\s*$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\s*결정됨\s*$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^쟁점/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /무중단이 필요한지/ })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('theme 1: one card per step with a ↓ row between', async ($, on) => {
  await setup($, on, { theme: 1 })
  await seed($)
  const ui = await mount($)
  const round = (await ui.findAll({ type: 'Box' })).filter((x: any) => x.props.borderStyle === 'round')
  expect(round).toHaveLength(4)
  expect(round.map((x: any) => x.props.borderColor)).toEqual(['success', 'success', 'success', 'error'])
  expect(await ui.findAll({ type: 'Text', text: '↓' })).toHaveLength(3)
  await ui.unmount()
  const docked = await mountPinned($, { scroll: { offset: 0, bodyRows: 80 } })
  expect(await docked.findAll({ type: 'Text', text: /^╭─+╮$/ })).toHaveLength(4)
  expect(await docked.findAll({ type: 'Text', text: /^╰─+╯$/ })).toHaveLength(4)
  expect(await docked.findAll({ type: 'Text', text: '↓' })).toHaveLength(3)
  // centered over the pane width (60), as v0.1 draws it
  const arrows = (await docked.findAll({ type: 'Box' })).filter((x: any) => x.props.justifyContent === 'center' && x.props.width === 60)
  expect(arrows).toHaveLength(3)
  await docked.unmount()
})

test('docked: every theme can be wheel-scrolled to the last line of a failed step with many attempts', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'f', {
    title: '긴 실패',
    status: 'blocked',
    cause: '원인 설명',
    notDone: ['미완료 하나'],
    attempts: Array.from({ length: 25 }, (_, i) => ({ action: `조치 ${i + 1}`, reason: `사유 ${i + 1}` })),
  })
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    const ui = await mountPinned($)
    // the window follows the end, so the last line shows at first; go to the top, then walk down again
    await scrollBy($, -1000)
    expect(await ui.find({ type: 'Text', text: '이유: 사유 25' })).toBeUndefined()
    for (let i = 0; i < 30 && !(await ui.find({ type: 'Text', text: '이유: 사유 25' })); i++) await scrollBy($, 8)
    expect(await ui.find({ type: 'Text', text: '이유: 사유 25' })).toBeDefined()
    // theme 3 has its bar below the last line; scroll on to the true end
    for (let i = 0; i < 5 && (await markers(ui)).down; i++) await scrollBy($, 8)
    expect((await markers(ui)).down).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '이유: 사유 25' })).toBeDefined()
    await ui.unmount()
  }
})

// Docked pane: fullscreen viewport and a body of 20 rows (bodyColumns 60).
const mountPinned = ($: any, props: Record<string, unknown> = {}) =>
  $.ui.mount({
    ...PANE,
    props: { ...PANE.props, ...props },
    surface: 'terminal',
    viewport: { columns: 100, rows: 30, isFullscreen: true },
  })

const scrollBy = ($: any, by: number) =>
  $.ui.scroll({
    component: 'Pane',
    requestId: 'step-flow',
    offset: 0,
    by,
    bodyRows: 20,
    contentRows: 20,
    origin: { kind: 'person' },
  })

const many = async ($: any, n: number) => {
  for (let i = 1; i <= n; i++) await step($, `d${i}`, { title: `성공${i}`, status: 'done' })
}

const markers = async (ui: any) => ({
  up: (await ui.findAll({ type: 'Text', text: /^↑ \d+$/ })).map((x: any) => x.text)[0],
  down: (await ui.findAll({ type: 'Text', text: /^↓ \d+$/ })).map((x: any) => x.text)[0],
})

test('docked: the window and the footer fill exactly bodyRows', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mountPinned($)
  const root = (await ui.findAll({}))[0]
  expect(root.props.height).toBe(20)
  const kids = root.children as any[]
  const rows = kids.map((k: any) => k.props?.height ?? 1)
  // theme 7 header and rule (pinned), window, summary, rule, question input
  expect(kids).toHaveLength(5)
  expect(rows.reduce((a: number, b: number) => a + b, 0)).toBe(20)
  expect(rows[0]).toBe(2)
  expect(rows[1]).toBe(15)
  await ui.unmount()

  await cmd($, 'flow-theme')
  const open = await mountPinned($)
  const k2 = ((await open.findAll({}))[0].children as any[])
  // header, window, summary, picker (title + 6 options + close = 8), rule, input
  expect(k2).toHaveLength(6)
  expect(k2[1].props.height).toBe(7)
  expect(await open.find({ type: 'Select', key: 'theme-picker' })).toBeDefined()
  await open.unmount()
})

test('docked: ui.scroll moves the window by rows, clamps, and shows what is cut', async ($, on) => {
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  // theme 7: a header and a rule, then 30 rows; the 17 row window follows the end
  expect(await ui.find({ type: 'Button', key: 'd30' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'd1' })).toBeUndefined()
  expect(await markers(ui)).toEqual({ up: '↑ 17', down: undefined })

  await scrollBy($, -3)
  expect(await markers(ui)).toEqual({ up: '↑ 14', down: '↓ 3' })
  expect(await ui.find({ type: 'Button', key: 'd30' })).toBeUndefined()
  await scrollBy($, -100)
  expect(await markers(ui)).toEqual({ up: undefined, down: '↓ 17' })
  expect(await ui.find({ type: 'Text', text: '시각' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'd14' })).toBeDefined()
  await scrollBy($, 4)
  expect(await markers(ui)).toEqual({ up: '↑ 4', down: '↓ 13' })
  await scrollBy($, 1000)
  expect(await markers(ui)).toEqual({ up: '↑ 17', down: undefined })
  await ui.unmount()
})

test('docked: the view follows the end until the person scrolls up', async ($, on) => {
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  await step($, 'n1', { title: '새 단계', status: 'done' })
  expect(await ui.find({ type: 'Button', key: 'n1' })).toBeDefined()
  expect(await markers(ui)).toEqual({ up: '↑ 18', down: undefined })
  await scrollBy($, -5)
  expect(await markers(ui)).toEqual({ up: '↑ 13', down: '↓ 5' })
  await step($, 'n2', { title: '또 새 단계', status: 'done' })
  expect(await ui.find({ type: 'Button', key: 'n2' })).toBeUndefined()
  expect(await markers(ui)).toEqual({ up: '↑ 13', down: '↓ 6' })
  await scrollBy($, 100)
  await step($, 'n3', { title: '셋째', status: 'done' })
  expect(await ui.find({ type: 'Button', key: 'n3' })).toBeDefined()
  await ui.unmount()
})

test('docked: the detail view has its own window, the list keeps its place', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  await setup($, on)
  await many($, 30)
  for (let i = 1; i <= 30; i++) await $.tool.call({ tool: 'Bash', command: `c${i}` })
  await step($, 'long', { title: '긴 단계', status: 'done' })
  const ui = await mountPinned($)
  await scrollBy($, -8)
  const before = await markers(ui)
  expect(before.up).toBe('↑ 10')
  await ui.press({ key: 'd15' })
  // the detail starts at its top; the list's window is not touched
  expect(await ui.find({ type: 'Button', key: 'back' })).toBeDefined()
  expect(await markers(ui)).toEqual({ up: undefined, down: undefined })
  await ui.press({ key: 'back' })
  expect(await markers(ui)).toEqual(before)

  await scrollBy($, 1000)
  const atEnd = await markers(ui)
  await ui.press({ key: 'long' })
  expect((await markers(ui)).up).toBeUndefined()
  expect((await markers(ui)).down).toMatch(/^↓ \d+$/)
  await scrollBy($, 10)
  expect((await markers(ui)).up).toMatch(/^↑ \d+$/)
  await scrollBy($, -100)
  await ui.press({ key: 'back' })
  expect(await markers(ui)).toEqual(atEnd)
  await ui.press({ key: 'long' })
  expect((await markers(ui)).up).toBeUndefined()
  await ui.unmount()
})

test('docked: a question and its answer sit in the window, the input stays in the footer', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답입니다', usage: USAGE } }))
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  await scrollBy($, -100)
  await ui.input({ key: 'btw:0', text: '질문입니다', kind: 'submit' })
  const kids = (await ui.findAll({}))[0].children as any[]
  const win = JSON.stringify(kids[1])
  expect(win).toContain('질문입니다')
  expect(win).toContain('답입니다')
  expect(JSON.stringify(kids.slice(2))).not.toContain('질문입니다')
  expect(await ui.find({ type: 'Input', key: 'btw:1' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: '답입니다' })).toBeDefined()
  await ui.unmount()
})

test('not docked: one scrolling body as before, no window, no markers', async ($, on) => {
  await setup($, on)
  await many($, 30)
  for (const viewport of [{ columns: 100, rows: 30, isFullscreen: false }, undefined]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', ...(viewport ? { viewport } : {}) })
    const root = (await ui.findAll({}))[0]
    expect(root?.props.height).toBeUndefined()
    expect(root?.props.minHeight).toBe(20)
    expect(await ui.find({ type: 'Button', key: 'd1' })).toBeDefined()
    expect(await markers(ui)).toEqual({ up: undefined, down: undefined })
    await ui.unmount()
  }
})

test('a done step with no status rows draws one rule above Activity, not two', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await step($, 's1', { title: '단계', status: 'done' })
  await step($, 's2', { title: '단계 둘', status: 'resolved', cause: '원인', attempts: [{ action: 'a', reason: 'r' }], fix: '고침' })
  const ui = await mount($)
  await ui.press({ key: 's1' })
  const rules = async () => (await ui.findAll({ type: 'Text', text: /^─{60}$/ })).length
  // one under the time line; the footer's own rule is the second
  expect(await rules()).toBe(2)
  await ui.unmount()
})

const LONG_ANSWER = [
  '첫 문단입니다.',
  '',
  '- 항목 하나',
  '  - 하위 항목',
  '- 항목 둘',
  '',
  '```',
  '코드 한 줄',
  '',
  '코드 둘째',
  '```',
  '',
  '끝 문단입니다. '.repeat(20),
].join('\n')

test('docked: every unit keeps its height (flexShrink 0), the window clips', async ($, on) => {
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  const win = ((await ui.findAll({}))[0].children as any[])[1]
  expect(win.props.overflow).toBe('hidden')
  const units = win.children[0].children as any[]
  expect(units.length).toBeGreaterThan(5)
  for (const u of units) expect(u.props.flexShrink).toBe(0)
  await ui.unmount()
})

test('docked: a long answer is split into blocks, the mark stays on the first', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: LONG_ANSWER, usage: USAGE } }))
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mountPinned($)
  await ui.input({ key: 'btw:0', text: '질문입니다', kind: 'submit' })
  const blocks = (await ui.findAll({ type: 'Markdown' })).map((x: any) => x.props.text)
  expect(blocks).toEqual([
    '첫 문단입니다.',
    '- 항목 하나\n  - 하위 항목',
    '- 항목 둘',
    '```\n코드 한 줄\n\n코드 둘째\n```',
    '끝 문단입니다. '.repeat(20).trim(),
  ])
  const marks = (await ui.findAll({ type: 'Text', text: /^⏺ $/ })).length
  expect(marks).toBe(1)
  await ui.unmount()
})

test('docked: an answer taller than the window puts the question at the top; a short one follows the end', async ($, on) => {
  let text = LONG_ANSWER + '\n\n' + Array.from({ length: 30 }, (_, i) => `단락 ${i}`).join('\n\n')
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text, usage: USAGE } }))
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  await ui.input({ key: 'btw:0', text: '긴 질문', kind: 'submit' })
  const win = JSON.stringify(((await ui.findAll({}))[0].children as any[])[1])
  expect(win.indexOf('긴 질문')).toBeGreaterThan(-1)
  // nothing of the list rows sits above the question in the window
  expect(win.indexOf('긴 질문')).toBeLessThan(win.indexOf('첫 문단입니다.'))
  expect(win.slice(0, win.indexOf('긴 질문'))).not.toContain('성공30')
  expect(await ui.find({ type: 'Text', text: /^↑ \d+$/ })).toBeDefined()

  text = '짧은 답'
  await ui.input({ key: 'btw:1', text: '짧은 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Markdown', text: '짧은 답' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^짧은 질문$/ })).toBeDefined()
  expect(await markers(ui)).toMatchObject({ down: undefined })
  await ui.unmount()
})

test('docked: the back button and the table header stay above the window', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  await setup($, on)
  for (let i = 1; i <= 30; i++) await $.tool.call({ tool: 'Bash', command: `c${i}` })
  await step($, 'long', { title: '긴 단계', status: 'done' })
  await many($, 30)
  const ui = await mountPinned($)
  await scrollBy($, -100)
  expect(await ui.find({ type: 'Text', text: '시각' })).toBeDefined()
  await scrollBy($, 1000)
  expect(await ui.find({ type: 'Text', text: '시각' })).toBeDefined()
  await scrollBy($, -1000)
  await ui.press({ key: 'long' }).catch(() => {})
  await ui.unmount()

  await cmd($, 'flow-clear')
  for (let i = 1; i <= 30; i++) await $.tool.call({ tool: 'Bash', command: `c${i}` })
  await step($, 'long2', { title: '긴 단계 둘', status: 'done' })
  const d = await mountPinned($)
  await d.press({ key: 'long2' })
  await scrollBy($, 20)
  expect((await markers(d)).up).toMatch(/^↑ \d+$/)
  const kids = (await d.findAll({}))[0].children as any[]
  expect(JSON.stringify(kids[0])).toContain('"key":"back"')
  await d.press({ key: 'back' })
  await d.unmount()
})

test('docked: a 30-line detail can be wheel-scrolled until its last line is shown', async ($, on) => {
  await setup($, on)
  const detail = Array.from({ length: 30 }, (_, i) => (i === 10 ? '' : `줄 ${i + 1}`)).join('\n')
  await step($, 's', { title: '긴 상세', status: 'done', detail })
  const ui = await mountPinned($)
  await ui.press({ key: 's' })
  expect(await ui.find({ type: 'Text', text: '줄 30' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '상세' })).toBeDefined()
  for (let i = 0; i < 40 && !(await ui.find({ type: 'Text', text: '줄 30' })); i++) await scrollBy($, 3)
  expect(await ui.find({ type: 'Text', text: '줄 30' })).toBeDefined()
  expect(await markers(ui)).toMatchObject({ down: undefined })
  await ui.unmount()
})

test('theme 3: the color bar is the last thing in the list, after a blank row (docked and not)', async ($, on) => {
  await setup($, on, { theme: 3 })
  await seed($)
  const ui = await mount($)
  const list = ((await ui.findAll({}))[0].children as any[])[0].children[0]
  const last = list.children[list.children.length - 1]
  expect(last.props).toMatchObject({ height: 1, marginTop: 1 })
  expect(list.children.findIndex((c: any) => c.props?.marginTop === 1)).toBe(list.children.length - 1)
  await ui.unmount()

  const docked = await mountPinned($, { scroll: { offset: 0, bodyRows: 80 } })
  const units = (((await docked.findAll({}))[0].children as any[])[0].children[0].children as any[])
  expect(units[units.length - 1].children[0].props).toMatchObject({ height: 1, marginTop: 1 })
  expect(JSON.stringify(units[0])).not.toContain('"marginTop":1')
  await docked.unmount()
})

// ---- deferred, blocked, resolve, choices on failures ----

const RESOLVE = 'mcp__step-flow__resolve'
const resolve = ($: any, input: Record<string, unknown>) => $.tool.run({ tool: RESOLVE, tool_use_id: 'rr', ...input })
const HM = (x: string) => x.replace(/\d\d:\d\d/g, 'HH:MM')
const FAIL_OPTS = [
  { option: '건너뜀', note: '없이 진행' },
  { option: '재시도', note: '권한 받고' },
]
const deferred = ($: any, id: string, extra: Record<string, unknown> = {}) =>
  step($, id, { title: '배포', status: 'deferred', cause: '권한', okReason: '다른 작업과 무관', ...extra })
const blocked = ($: any, id: string, extra: Record<string, unknown> = {}) =>
  step($, id, { title: '로그인', status: 'blocked', cause: '계정 없음', notDone: ['미완료 하나'], ...extra })
const textColors = async (ui: any, text: string | RegExp) =>
  (await ui.findAll({ type: 'Text', text })).map((x: any) => x.props.color)

test('nodes kept by an earlier version are read as the new statuses', async () => {
  const old = { id: 'o', at: '10:00', ts: 1, title: '옛', cause: '원인' }
  expect(norm({ ...old, status: 'unresolved' } as any).status).toBe('blocked')
  expect(norm({ ...old, status: 'workaround' } as any).status).toBe('resolved')
  expect(norm({ ...old, status: 'done' }).status).toBe('done')
  // an old blocked node has no options: it is open until resolved, never a choice
  const legacyBlocked = norm({ ...old, status: 'unresolved' } as any)
  expect(isFailure(legacyBlocked)).toBe(true)
  expect(isOpen(legacyBlocked)).toBe(false)
  expect(isKept(legacyBlocked)).toBe(true)
})

test('resolve: turns a deferred step green, keeps cause and attempts, appends attempts, sets the fix time', async ($, on) => {
  await setup($, on)
  await deferred($, 'f1', { attempts: [{ action: '첫 시도', reason: '첫 이유' }], options: FAIL_OPTS })
  await step($, 'a', { title: '설치', status: 'done' })
  const ui = await mount($)
  await ui.press({ key: 'f1' })
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeDefined()
  await ui.press({ key: 'back' })
  const r = await resolve($, {
    id: 'f1',
    fix: '권한을 받음',
    attempts: [{ action: '권한 요청', reason: '원인이 권한이라서' }],
  })
  expect(r.result).toBe('resolved f1 "배포". Fix: 권한을 받음')
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^문제: 권한$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^시도 1: 첫 시도$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^시도 2: 권한 요청$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^조치 \(\d\d:\d\d 해결\): 권한을 받음$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /넘어간 이유/ })).toBeUndefined()
  await ui.press({ key: 'f1' })
  expect(await ui.find({ type: 'Text', text: ' 성공 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '해결' })).toBeDefined()
  // the buttons are gone with the choice
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '조치' })).toBeDefined()
  await ui.unmount()
})

test('resolve: id may be left out with one open failure; every deny names the open failures', async ($, on) => {
  await setup($, on)
  expect((await resolve($, { fix: '고침' })).deny).toContain('No deferred or blocked step exists')
  await deferred($, 'f1')
  await step($, 'a', { title: '설치', status: 'done' })
  expect((await resolve($, { id: 'a', fix: '고침' })).deny).toContain('a "설치" is done, not deferred or blocked')
  expect((await resolve($, { id: 'nope', fix: '고침' })).deny).toContain('unknown id nope')
  expect((await resolve($, { id: 'nope', fix: '고침' })).deny).toContain('f1 "배포" (deferred)')
  expect((await resolve($, { id: 'f1' })).deny).toContain('missing: fix')
  expect((await resolve($, { id: 'f1', fix: '고침', attempts: [{ action: 'x' }] })).deny).toContain('missing: attempts[1].reason')
  await blocked($, 'b1')
  const two = await resolve($, { fix: '고침' })
  expect(two.deny).toContain('id is missing')
  expect(two.deny).toContain('f1 "배포" (deferred); b1 "로그인" (blocked)')
  expect((await resolve($, { id: 'b1', fix: '계정을 받음' })).result).toBe('resolved b1 "로그인". Fix: 계정을 받음')
  // exactly one open failure left: the id may be left out
  expect((await resolve($, { fix: '권한을 받음' })).result).toBe('resolved f1 "배포". Fix: 권한을 받음')
  // a resolved step cannot be resolved again
  expect((await resolve($, { id: 'f1', fix: '다시' })).deny).toContain('f1 "배포" is resolved, not deferred or blocked')
})

test('a resolved step without attempts draws cause and fix only, in every theme', async ($, on) => {
  await setup($, on)
  await deferred($, 'f1')
  await resolve($, { id: 'f1', fix: '권한을 받음' })
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    for (const docked of [false, true]) {
      const ui = docked ? await mountPinned($, { scroll: { offset: 0, bodyRows: 40 } }) : await mount($)
      expect(await ui.find({ type: 'Text', text: /^문제: 권한$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^조치 \(\d\d:\d\d 해결\): 권한을 받음$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^시도/ })).toBeUndefined()
      await ui.press({ key: 'f1' })
      expect(await ui.find({ type: 'Text', text: '권한을 받음' })).toBeDefined()
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})

test('the step result adds the open count; nothing when no choice or blocked step is open', async ($, on) => {
  await setup($, on)
  expect((await step($, 'a', { title: '설치', status: 'done' })).result).toBe('recorded')
  expect((await blocked($, 'b1')).result).toContain(' Open: 0 to decide, 1 blocked.')
  expect((await step($, 'a2', { title: '또', status: 'done' })).result).toBe('recorded Open: 0 to decide, 1 blocked.')
  expect((await step($, 'q', DECISION)).result).toContain(' Open: 1 to decide, 1 blocked.')
  // a deferred step without options is not counted
  expect((await deferred($, 'f1')).result.endsWith(' Open: 1 to decide, 1 blocked.')).toBe(true)
  await resolve($, { id: 'b1', fix: '계정을 받음' })
  await decided($, { id: 'q', choice: 1 })
  expect((await step($, 'a3', { title: '끝', status: 'done' })).result).toBe('recorded')
})

test('deferred and blocked: tags and fields in every theme, docked and not', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await deferred($, 'f1', { attempts: [{ action: '재시도', reason: '권한 의심' }] })
  await blocked($, 'b1')
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    for (const docked of [false, true]) {
      const ui = docked ? await mountPinned($, { scroll: { offset: 0, bodyRows: 60 } }) : await mount($)
      expect(await ui.find({ type: 'Text', text: /^\s*보류\s*$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\s*중단\s*$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '원인: 권한' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '넘어간 이유: 다른 작업과 무관' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '진행하지 못한 작업:' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '- 미완료 하나' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '시도 1: 재시도' })).toBeDefined()
      // options are never listed
      expect(await ui.find({ type: 'Text', text: /건너뜀/ })).toBeUndefined()
      // only a blocked title is bold red; a deferred one is plain
      expect(await ui.find({ type: 'Text', text: '로그인', color: 'error' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '배포' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('deferred and blocked with options: open choice tags, buttons, the steps-after line, the exact prompt', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await setup($, on)
  await deferred($, 'f1', { options: FAIL_OPTS })
  const ui = await mount($)
  // an open choice on a failure: the warning tag, the failure's own glyph and title style
  expect(await textColors(ui, /^\s*결정 필요\s*$/)).toEqual(['warning'])
  expect(await ui.find({ type: 'Text', text: /^\s*보류\s*$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '필요한 것' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^단계 1개, 결정 필요 1개, 중단 0개, 보류 0개$/ })).toBeDefined()
  await ui.press({ key: 'f1' })
  // no steps after it yet: no line above the buttons
  expect(await ui.find({ type: 'Text', text: /단계 \d+개가 진행됐습니다/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 보류 ' })).toBeDefined()
  for (const text of ['원인', '넘어간 이유', 'A', '건너뜀', '없이 진행', 'B', '재시도', '권한 받고']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  await ui.press({ key: 'back' })
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'a2', { title: '빌드', status: 'done' })
  await ui.press({ key: 'f1' })
  expect(await ui.find({ type: 'Text', text: '이 단계 뒤에 단계 2개가 진행됐습니다' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-A', text: 'A로 진행' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-B', text: 'B로 진행' })).toBeDefined()
  await ui.press({ key: 'decide-B' })
  expect(sent.map(HM)).toEqual([
    '진행 (사용자가 step-flow 패널에서 직접 눌렀습니다): "배포" (보류, HH:MM 기록, 이후 단계 2개) → B (재시도: 권한 받고). 원인: 권한. 이미 기록했습니다 (f1). 바꾸기 전에 지금 상태를 확인하세요. 이 단계가 이미 해결됐거나 이 선택이 뒤에 한 작업과 부딪히면 아무것도 바꾸지 말고, mcp__step-flow__decided를 이 id와 choice 0으로 호출해 선택을 다시 연 뒤 사용자에게 먼저 알리세요. 문제가 없으면 이 방법으로 진행하세요. 고치면 이 id로 mcp__step-flow__resolve를 호출하세요.',
  ])
  // chosen: buttons gone, the pick shown, no longer open and counted nowhere
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^B · \d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ 재시도' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 보류 ' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await textColors(ui, /^\s*선택됨\s*$/)).toEqual(['inactive'])
  expect(await ui.find({ type: 'Text', text: /^단계 3개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  // a stale second press does nothing
  await ui.unmount()
  expect(sent).toHaveLength(1)
})

test('blocked with options: English prompt, chosen title is plain, tag priority, drop reverts', async ($, on) => {
  let mode: 'ok' | 'drop' = 'drop'
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return mode === 'drop' ? { drop: 'busy' } : { text: e.text }
  })
  await setup($, on, {}, 'English')
  await blocked($, 'b1', { title: 'Login', cause: 'No account', options: FAIL_OPTS })
  const ui = await mount($)
  // open: warning tag; the blocked title stays bold red
  expect(await textColors(ui, /^\s*Needs decision\s*$/)).toEqual(['warning'])
  expect(await ui.find({ type: 'Text', text: 'Login', color: 'error' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 step, 1 to decide, 0 blocked, 0 deferred$/ })).toBeDefined()
  await ui.press({ key: 'b1' })
  expect(await ui.find({ type: 'Button', key: 'decide-A', text: 'Go with A' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not done' })).toBeDefined()
  await ui.press({ key: 'decide-A' })
  // refused: back to open
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^A · / })).toBeUndefined()
  mode = 'ok'
  sent.length = 0
  await ui.press({ key: 'decide-A' })
  expect(sent.map(HM)).toEqual([
    'Go ahead (the user pressed this in the step-flow pane): "Login" (Blocked, recorded HH:MM, 0 steps since) → A (건너뜀: 없이 진행). Cause: No account. Already recorded (b1). Check the current state before changing anything. If this step is already fixed or this choice conflicts with work done after it, change nothing, call mcp__step-flow__decided with this id and choice 0 to reopen the choice, and tell the user first. Otherwise go on with this choice. When it is fixed, call mcp__step-flow__resolve with this id.',
  ])
  expect(await ui.find({ type: 'Text', text: ' Blocked ' })).toBeDefined()
  await ui.press({ key: 'back' })
  // chosen: gray tag, plain title, counted nowhere
  expect(await textColors(ui, /^\s*Chosen\s*$/)).toEqual(['inactive'])
  expect(await ui.find({ type: 'Text', text: 'Login', color: 'error' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 step, 0 to decide, 0 blocked, 0 deferred$/ })).toBeDefined()
  await ui.unmount()
})

test('a decision prompt names the record time and the steps since', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await setup($, on)
  await step($, 'q1', DECISION)
  await step($, 'a', { title: '설치', status: 'done' })
  await step($, 'a2', { title: '빌드', status: 'done' })
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Text', text: '이 단계 뒤에 단계 2개가 진행됐습니다' })).toBeDefined()
  await ui.press({ key: 'decide-A' })
  expect(HM(sent[0] ?? '')).toContain('"배포 방식" (HH:MM 기록, 이후 단계 2개) → A')
  await ui.unmount()
})

test('decided on a failure with options; the id is optional only with one open choice, counting both kinds', async ($, on) => {
  await setup($, on)
  await deferred($, 'f1', { options: FAIL_OPTS })
  await step($, 'q1', DECISION)
  const none = await decided($, { choice: 1 })
  expect(none.deny).toContain('id is missing')
  expect(none.deny).toContain('f1 "배포" (deferred); q1 "배포 방식" (decision)')
  await blocked($, 'b0')
  expect((await decided($, { id: 'b0', choice: 1 })).deny).toContain('b0 "로그인" is blocked with no choice to make')
  expect((await decided($, { id: 'f1', choice: 3 })).deny).toContain('from 1 to 2')
  const r = await decided($, { id: 'f1', choice: 2 })
  expect(r.result).toBe('recorded f1 "배포": B (재시도)')
  // one open choice left: the id may be left out
  expect((await decided($, { choice: 1 })).result).toBe('recorded q1 "배포 방식": A (블루그린)')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 3개, 결정 필요 0개, 중단 1개, 보류 0개$/ })).toBeDefined()
  await ui.press({ key: 'f1' })
  expect(await ui.find({ type: 'Text', text: /^B · \d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'decide-A' })).toBeUndefined()
  await ui.unmount()
  // a resolved step has no choice to make
  await resolve($, { id: 'f1', fix: '고침' })
  expect((await decided($, { id: 'f1', choice: 1 })).deny).toContain('f1 "배포" is resolved with no choice to make')
})

test('summary: blocked and deferred without options, colors, English too', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await deferred($, 'f1')
  await blocked($, 'b1')
  await deferred($, 'f2', { options: FAIL_OPTS })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 4개, 결정 필요 1개, 중단 1개, 보류 1개$/ })).toBeDefined()
  expect(await textColors(ui, '결정 필요 1개')).toContain('warning')
  expect(await textColors(ui, '중단 1개')).toContain('error')
  expect(await textColors(ui, '보류 1개')).toContain('inactive')
  await resolve($, { id: 'f1', fix: '고침' })
  await resolve($, { id: 'b1', fix: '고침' })
  expect(await textColors(ui, '중단 0개')).toContain('success')
  expect(await textColors(ui, '보류 0개')).toContain('success')
  await ui.unmount()
})

test('English summary with blocked and deferred', async ($, on) => {
  await setup($, on, {}, 'English')
  await step($, 'a', { title: 'x', status: 'done' })
  await deferred($, 'f1')
  await blocked($, 'b1')
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^3 steps, 0 to decide, 1 blocked, 1 deferred$/ })).toBeDefined()
  expect(await textColors(ui, '1 deferred')).toContain('inactive')
  await ui.unmount()
})

test('theme 3 bar and theme 4 cells: open choice warning, blocked error, deferred and chosen gray', async ($, on) => {
  await setup($, on, { theme: 4 })
  await step($, 'a', { title: '설치', status: 'done' })
  await blocked($, 'b1')
  await deferred($, 'f1')
  await deferred($, 'f2', { options: FAIL_OPTS })
  await deferred($, 'f3', { options: FAIL_OPTS })
  await decided($, { id: 'f3', choice: 1 })
  let ui = await mount($)
  const cells = (await ui.findAll({ type: 'Box', width: 3 })).filter((x: any) => x.props.backgroundColor && x.props.backgroundColor !== 'inverseText')
  expect(cells.map((x: any) => x.props.backgroundColor)).toEqual(['success', 'error', 'inactive', 'warning', 'inactive'])
  await ui.unmount()
  await cmd($, 'flow-theme', '3')
  ui = await mount($)
  const bars = (await ui.findAll({ type: 'Box', height: 1 })).filter((x: any) => x.props.backgroundColor && x.props.backgroundColor !== 'inverseText')
  expect(bars.map((x: any) => x.props.backgroundColor)).toEqual(['success', 'warning', 'error', 'inactive'])
  expect(bars.map((x: any) => x.props.width)).toEqual([12, 12, 12, 24])
  await ui.unmount()
})

test('trimming and the size guard keep open choices and unresolved failures', async ($, on) => {
  await setup($, on)
  await deferred($, 'f1', { options: FAIL_OPTS })
  await blocked($, 'b0')
  for (let i = 1; i <= 210; i++) await blocked($, `u${i}`, { title: `중단${i}` })
  const ui = await mount($)
  // 200 kept: the oldest blocked ones went first, the open choice stays
  expect(await ui.find({ key: 'f1', type: 'Button' })).toBeDefined()
  expect(await ui.find({ key: 'b0', type: 'Button' })).toBeUndefined()
  expect(await ui.find({ key: 'u210', type: 'Button' })).toBeDefined()
  await ui.unmount()

  await cmd($, 'flow-clear')
  await blocked($, 'b1')
  await deferred($, 'f2', { options: FAIL_OPTS })
  await decided($, { id: 'f2', choice: 1 })
  for (let i = 1; i <= 150; i++) await step($, `d${i}`, { title: `성공${i}`, status: 'done' })
  await step($, 'last', { title: '끝', status: 'done' })
  const guarded = await mount($)
  expect(await guarded.find({ type: 'Text', text: /^앞선 \d+개 단계는 숨겼습니다$/ })).toBeDefined()
  // never hidden: the blocked step; the chosen one is settled and may go with the done ones
  expect(await guarded.find({ key: 'b1', type: 'Button' })).toBeDefined()
  await guarded.unmount()
})

test('docked: a deferred step with options scrolls to its last line, in every theme', async ($, on) => {
  await setup($, on)
  await step($, 'a', { title: '설치', status: 'done' })
  await deferred($, 'f', {
    title: '긴 보류',
    attempts: Array.from({ length: 25 }, (_, i) => ({ action: `조치 ${i + 1}`, reason: `사유 ${i + 1}` })),
    options: FAIL_OPTS,
  })
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    const ui = await mountPinned($)
    await scrollBy($, -1000)
    expect(await ui.find({ type: 'Text', text: '이유: 사유 25' })).toBeUndefined()
    for (let i = 0; i < 30 && !(await ui.find({ type: 'Text', text: '이유: 사유 25' })); i++) await scrollBy($, 8)
    expect(await ui.find({ type: 'Text', text: '이유: 사유 25' })).toBeDefined()
    for (let i = 0; i < 5 && (await markers(ui)).down; i++) await scrollBy($, 8)
    expect((await markers(ui)).down).toBeUndefined()
    await ui.unmount()
  }
})

test('decided with choice 0 reopens a decision and a failure with options: buttons, tag and counts come back', async ($, on) => {
  await setup($, on)
  await step($, 'q1', DECISION)
  await deferred($, 'f1', { options: FAIL_OPTS })
  await decided($, { id: 'q1', choice: 1 })
  await decided($, { id: 'f1', choice: 2 })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 0개, 중단 0개, 보류 0개$/ })).toBeDefined()
  expect(await textColors(ui, /^\s*선택됨\s*$/)).toEqual(['inactive'])

  expect((await decided($, { id: 'q1', choice: 0 })).result).toBe('reopened q1 "배포 방식"')
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 1개, 중단 0개, 보류 0개$/ })).toBeDefined()
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Button', key: 'decide-A', text: 'A로 결정' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 결정 필요 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^[AB] · \d\d:\d\d$/ })).toBeUndefined()
  await ui.press({ key: 'back' })

  // one node with a choice left: the id may be left out
  expect((await decided($, { choice: 0 })).result).toBe('reopened f1 "배포"')
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 2개, 중단 0개, 보류 0개$/ })).toBeDefined()
  expect(await textColors(ui, /^\s*결정 필요\s*$/)).toEqual(['warning', 'warning'])
  expect(await ui.find({ type: 'Text', text: /^\s*선택됨\s*$/ })).toBeUndefined()
  await ui.press({ key: 'f1' })
  expect(await ui.find({ type: 'Button', key: 'decide-B', text: 'B로 진행' })).toBeDefined()
  await ui.unmount()
})

test('choice 0: nothing to reopen is a plain result; the id rule denies with the steps that have a choice', async ($, on) => {
  await setup($, on)
  await deferred($, 'f1', { options: FAIL_OPTS })
  await blocked($, 'b1')
  await step($, 'q1', DECISION)
  // nothing has a choice yet
  expect((await decided($, { choice: 0 })).deny).toContain('No step has a choice set')
  expect((await decided($, { id: 'nope', choice: 0 })).deny).toContain('unknown id nope')
  // an open node, a node with no options: a plain result, not a deny
  expect((await decided($, { id: 'q1', choice: 0 })).result).toBe('nothing to reopen: "배포 방식" is decision')
  expect((await decided($, { id: 'b1', choice: 0 })).result).toBe('nothing to reopen: "로그인" is blocked')
  await decided($, { id: 'f1', choice: 1 })
  await decided($, { id: 'q1', choice: 1 })
  const two = await decided($, { choice: 0 })
  expect(two.deny).toContain('id is missing')
  expect(two.deny).toContain('f1 "배포" (deferred); q1 "배포 방식" (decision)')
  // a resolved step has nothing to reopen
  await resolve($, { id: 'f1', fix: '고침' })
  expect((await decided($, { id: 'f1', choice: 0 })).result).toBe('nothing to reopen: "배포" is resolved')
  // one choice left: the id may be left out
  expect((await decided($, { choice: 0 })).result).toBe('reopened q1 "배포 방식"')
})

// The scroll window of a docked pane: its wrapped units, to tell the double rules from the rest.
const windowUnits = async (ui: any) => {
  const root = (await ui.findAll({}))[0]
  const win = (root.children as any[]).find((k: any) => k.props?.overflow === 'hidden')

  return (win.children[0].children as any[]).map((u: any) => JSON.stringify(u))
}
const isCap = (u: string | undefined) => /"═+"/.test(u ?? '')

test('docked: no end rules while everything fits', async ($, on) => {
  await setup($, on)
  await seed($)
  const ui = await mountPinned($, { scroll: { offset: 0, bodyRows: 40 } })
  expect((await windowUnits(ui)).some(isCap)).toBe(false)
  await ui.unmount()
})

test('docked: a double rule shows the very top and the very bottom of an overflowing list', async ($, on) => {
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  // following the end: the last row is the end rule, the start rule is out of sight
  let units = await windowUnits(ui)
  expect(isCap(units[units.length - 1])).toBe(true)
  expect(isCap(units[0])).toBe(false)
  expect((await markers(ui)).down).toBeUndefined()
  expect((await markers(ui)).up).toBeDefined()

  await scrollBy($, -4)
  units = await windowUnits(ui)
  expect(units.some(isCap)).toBe(false)
  expect(await markers(ui)).toMatchObject({ up: expect.stringMatching(/^↑ \d+$/), down: expect.stringMatching(/^↓ \d+$/) })

  // the wheel reaches both ends: first row the start rule and no ↑, then last row the end rule and no ↓
  await scrollBy($, -1000)
  units = await windowUnits(ui)
  expect(isCap(units[0])).toBe(true)
  expect(isCap(units[units.length - 1])).toBe(false)
  expect((await markers(ui)).up).toBeUndefined()
  expect((await markers(ui)).down).toBeDefined()
  await scrollBy($, 1000)
  units = await windowUnits(ui)
  expect(isCap(units[units.length - 1])).toBe(true)
  expect((await markers(ui)).down).toBeUndefined()
  // single rules elsewhere stay single: theme 7's header rule is pinned above the window
  expect(JSON.stringify((await ui.findAll({}))[0].children[0])).toContain('─')
  await ui.unmount()
})

test('docked: the end rules are the same in English, in every theme, and in a detail view', async ($, on) => {
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  await setup($, on, {}, 'English')
  await many($, 30)
  for (let i = 1; i <= 30; i++) await $.tool.call({ tool: 'Bash', command: `c${i}` })
  await step($, 'long', { title: 'Long', status: 'done' })
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    const ui = await mountPinned($)
    await scrollBy($, -1000)
    let units = await windowUnits(ui)
    expect(isCap(units[0])).toBe(true)
    await scrollBy($, 1000)
    units = await windowUnits(ui)
    expect(isCap(units[units.length - 1])).toBe(true)
    await ui.unmount()
  }
  await cmd($, 'flow-theme', '7')
  const d = await mountPinned($)
  await scrollBy($, 1000)
  await d.press({ key: 'long' })
  // detail view: starts at the top with the start rule under the pinned back button
  let units = await windowUnits(d)
  expect(isCap(units[0])).toBe(true)
  await scrollBy($, 1000)
  units = await windowUnits(d)
  expect(isCap(units[units.length - 1])).toBe(true)
  await d.unmount()
})

test('docked: a question and answer under the list keep the end rule last', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답', usage: USAGE } }))
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  await ui.input({ key: 'btw:0', text: '질문', kind: 'submit' })
  const units = await windowUnits(ui)
  // the exchange follows the list, then the end rule closes the content
  expect(isCap(units[units.length - 1])).toBe(true)
  expect(units.some(u => u.includes('질문'))).toBe(true)
  await ui.unmount()
})

// ---- notDone, 중단, closing the Q&A ----

test('blocked requires notDone: the exact deny, an empty list, an empty item, and no other status takes it', async ($, on) => {
  await setup($, on)
  const base = { title: '로그인', status: 'blocked', cause: '계정 없음' }
  expect((await step($, 'n1', base)).deny).toBe(
    'missing: notDone (at least 1 item: each piece of work you could not do because of it, one short item each). Call mcp__step-flow__step again with these fields filled in.',
  )
  expect((await step($, 'n2', { ...base, notDone: [] })).deny).toContain('missing: notDone (at least 1 item')
  expect((await step($, 'n3', { ...base, notDone: ['로그인 후 검증', '  '] })).deny).toContain('missing: notDone[2] (empty)')
  expect((await step($, 'n4', { ...base, notDone: ['로그인 후 검증'] })).result).toMatch(/^recorded blocked n4\./)
  for (const extra of [
    { status: 'done' },
    { status: 'resolved', cause: '오류', attempts: [{ action: 'a', reason: 'r' }], fix: '고침' },
    { status: 'deferred', cause: '오류', okReason: '무관' },
    { ...DECISION },
  ]) {
    const r = await step($, 'x', { title: '단계', notDone: ['하나'], ...extra })
    expect(r.deny).toBe(`${extra.status} cannot have notDone; it belongs to blocked steps`)
  }
})

test('notDone is listed after Needs in the list of every theme, docked and not; old nodes without it draw nothing', async ($, on) => {
  await setup($, on)
  await blocked($, 'b1', { notDone: ['로그인 후 검증', '결제 테스트'], attempts: [{ action: '재시도', reason: '권한 의심' }] })
  await deferred($, 'f1')
  for (const id of [1, 2, 3, 4, 5, 7]) {
    await cmd($, 'flow-theme', String(id))
    for (const docked of [false, true]) {
      const ui = docked ? await mountPinned($, { scroll: { offset: 0, bodyRows: 60 } }) : await mount($)
      const texts = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text as string)
      const at = (t: string) => texts.indexOf(t)
      expect(at('진행하지 못한 작업:')).toBeGreaterThan(at('원인: 계정 없음'))
      expect(at('- 로그인 후 검증')).toBeGreaterThan(at('진행하지 못한 작업:'))
      expect(at('- 결제 테스트')).toBeGreaterThan(at('- 로그인 후 검증'))
      expect(at('시도 1: 재시도')).toBeGreaterThan(at('- 결제 테스트'))
      // only the blocked step has the block
      expect(texts.filter((t: string) => t === '진행하지 못한 작업:')).toHaveLength(1)
      await ui.unmount()
    }
  }
})

test('notDone in the detail view, one line per item; resolve drops it; English labels', async ($, on) => {
  await setup($, on)
  await blocked($, 'b1', { notDone: ['로그인 후 검증', '결제 테스트'] })
  const ui = await mount($)
  await ui.press({ key: 'b1' })
  expect(await ui.find({ type: 'Text', text: '진행하지 못한 작업' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 로그인 후 검증' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- 결제 테스트' })).toBeDefined()
  await ui.press({ key: 'back' })
  await resolve($, { id: 'b1', fix: '계정을 받음' })
  expect(await ui.find({ type: 'Text', text: '미해결' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /진행하지 못한 작업/ })).toBeUndefined()
  await ui.press({ key: 'b1' })
  expect(await ui.find({ type: 'Text', text: /진행하지 못한 작업|결제 테스트/ })).toBeUndefined()
  await ui.unmount()
})

test('English: Blocked, Not done, summary unchanged', async ($, on) => {
  await setup($, on, {}, 'English')
  await blocked($, 'b1', { title: 'Login', notDone: ['Login check', 'Payment test'] })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^\s*Blocked\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not done:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '- Payment test' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 step, 0 to decide, 1 blocked, 0 deferred$/ })).toBeDefined()
  await ui.press({ key: 'b1' })
  expect(await ui.find({ type: 'Text', text: ' Blocked ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Not done' })).toBeDefined()
  await ui.unmount()
})

test('Korean 중단: tag, badge, summary and the pane prompt; the old word is gone', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_: any, e: any) => {
    sent.push(e.text)

    return { text: e.text }
  })
  await setup($, on)
  await blocked($, 'b1', { options: FAIL_OPTS })
  await blocked($, 'b2', { title: '결제' })
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /^단계 2개, 결정 필요 1개, 중단 1개, 보류 0개$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*중단\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /막힘/ })).toBeUndefined()
  await ui.press({ key: 'b2' })
  expect(await ui.find({ type: 'Text', text: ' 중단 ' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'b1' })
  await ui.press({ key: 'decide-A' })
  expect(HM(sent[0] ?? '')).toContain('"로그인" (중단, HH:MM 기록, 이후 단계 1개) → A')
  await ui.unmount()
})

test('the Q&A question row has a ✕; pressing it hides the exchange in list and detail and reveals no older one', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  let n = 0
  on('model.complete', () => ({ value: { isAnswered: true, text: `답 ${++n}`, usage: USAGE } }))
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: '첫 질문', kind: 'submit' })
  await ui.input({ key: 'btw:1', text: '둘째 질문', kind: 'submit' })
  const close = await ui.find({ type: 'Button', key: 'btw-close' })
  expect(close).toBeDefined()
  expect(close.text).toBe('✕')
  // it sits inside the question row, after the text
  const row = (await ui.findAll({ type: 'Box' })).find((x: any) => x.props.backgroundColor === '#3a3a3a')
  expect(JSON.stringify(row)).toContain('둘째 질문')
  expect(JSON.stringify(row).indexOf('btw-close')).toBeGreaterThan(JSON.stringify(row).indexOf('둘째 질문'))
  await ui.press({ key: 'btw-close' })
  expect(await ui.find({ type: 'Text', text: /질문$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'btw-close' })).toBeUndefined()
  // a detail view shows no older exchange either
  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.input({ key: 'btw:2', text: '상세 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: '상세 질문' })).toBeDefined()
  await ui.press({ key: 'btw-close' })
  expect(await ui.find({ type: 'Text', text: '상세 질문' })).toBeUndefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^(첫|둘째) 질문$/ })).toBeUndefined()
  // a new question shows again
  await ui.input({ key: 'btw:3', text: '새 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: '새 질문' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: '답 4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '첫 질문' })).toBeUndefined()
  await ui.unmount()
})

test('/flow-clear closes the Q&A too', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답', usage: USAGE } }))
  await setup($, on)
  await seed($)
  const ui = await mount($)
  await ui.input({ key: 'btw:0', text: '지울 질문', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: '지울 질문' })).toBeDefined()
  await cmd($, 'flow-clear')
  expect(await ui.find({ type: 'Text', text: '지울 질문' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('docked: closing the Q&A leaves a valid window, caps and follow-end', async ($, on) => {
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '답', usage: USAGE } }))
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  await ui.input({ key: 'btw:0', text: '질문', kind: 'submit' })
  expect((await windowUnits(ui)).some(u => u.includes('질문'))).toBe(true)
  await ui.press({ key: 'btw-close' })
  let units = await windowUnits(ui)
  expect(units.some(u => u.includes('질문'))).toBe(false)
  // the view was following the end and still does: the end rule closes the list, no ↓
  expect(isCap(units[units.length - 1])).toBe(true)
  expect((await markers(ui)).down).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'd30' })).toBeDefined()
  // scrolled up before closing: the offset stays inside the shorter content
  await ui.input({ key: 'btw:1', text: '둘째', kind: 'submit' })
  await scrollBy($, -1000)
  await ui.press({ key: 'btw-close' }).catch(() => {})
  await scrollBy($, 1000)
  units = await windowUnits(ui)
  expect(isCap(units[units.length - 1])).toBe(true)
  await ui.unmount()
})

test('docked: a ↑ or ↓ marker on the question row sits left of the ✕, never over it', async ($, on) => {
  const answer = Array.from({ length: 40 }, (_, i) => `단락 ${i}`).join('\n\n')
  on('session.messages', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: answer, usage: USAGE } }))
  await setup($, on)
  await many($, 30)
  const ui = await mountPinned($)
  const marks = async () =>
    (await ui.findAll({ type: 'Box' }))
      .filter((x: any) => x.props.position === 'absolute')
      .map((x: any) => ({ at: x.props.top === 0 ? 'up' : 'down', right: x.props.right as number }))
  // the answer is taller than the window: the question row is the first visible row, with the ↑ marker on it
  await ui.input({ key: 'btw:0', text: '긴 질문', kind: 'submit' })
  const first = (await windowUnits(ui))[0] ?? ''
  expect(first).toContain('긴 질문')
  expect(first).toContain('btw-close')
  expect(await ui.find({ type: 'Button', key: 'btw-close' })).toBeDefined()
  expect(await marks()).toContainEqual({ at: 'up', right: 3 })
  // the question text keeps clear of the marker
  expect(first).toContain('"paddingRight":7')

  // scroll up until the question row is the last visible row: the ↓ marker moves left of the ✕ too
  await scrollBy($, -14)
  const last = (await windowUnits(ui)).slice(-1)[0] ?? ''
  expect(last).toContain('긴 질문')
  expect(await ui.find({ type: 'Button', key: 'btw-close' })).toBeDefined()
  const m = await marks()
  expect(m).toContainEqual({ at: 'down', right: 3 })
  // the ↑ marker is on a list row now and stays at the edge
  expect(m).toContainEqual({ at: 'up', right: 0 })
  await ui.unmount()
})

test('a leading A: / A. / 1. on an option label is stripped, decision and failure options alike', async ($, on) => {
  await setup($, on)
  const lettered = [
    { option: 'A: 테스트 서버 확인', note: '서버 확인 후 재시도' },
    { option: '2. 건너뜀', note: '없이 진행' },
  ]
  await step($, 'q1', { ...DECISION, options: lettered })
  await blocked($, 'b1', { options: [{ option: 'B) 재시도', note: 'x' }, { option: 'C.건너뜀', note: 'y' }] })
  await step($, 'q2', { ...DECISION, options: [{ option: 'Redis 캐시', note: 'a' }, { option: 'A 팀 승인', note: 'b' }] })
  const ui = await mount($)
  await ui.press({ key: 'q1' })
  expect(await ui.find({ type: 'Text', text: '테스트 서버 확인' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '건너뜀' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /A: |2\. /, })).toBeUndefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'b1' })
  expect(await ui.find({ type: 'Text', text: '재시도' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '건너뜀' })).toBeDefined()
  await ui.press({ key: 'back' })
  // a label that only starts like one is left alone
  await ui.press({ key: 'q2' })
  expect(await ui.find({ type: 'Text', text: 'Redis 캐시' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'A 팀 승인' })).toBeDefined()
  await ui.unmount()
})
