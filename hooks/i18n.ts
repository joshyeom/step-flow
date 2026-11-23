// A language is a table here plus one line in LOCALES.
export type Strings = {
  paneTitle: string
  // status words (badge, table result)
  ok: string
  blocked: string
  deferred: string
  chosen: string
  themes: Record<number, string>
  // field labels; the list views add ': '
  problem: string
  cause: string
  attempt: (n: number) => string
  reason: (why: string) => string
  fix: string
  // fix line of a node fixed later: `Fix (resolved 13:40)`
  fixAt: (time: string) => string
  okReason: string
  notDone: string
  resolvedRow: string
  detail: string
  // decision step
  needsDecision: string
  decided: string
  issue: string
  meanwhile: string
  stepsAfter: (k: number) => string
  decisionRow: string
  // text the pane submits as the user's choice (also read by the model)
  decisionPrompt: (title: string, letter: string, option: string, note: string, issue: string, id: string, at: string, k: number) => string
  goPrompt: (title: string, status: string, letter: string, option: string, note: string, cause: string, id: string, at: string, k: number) => string
  decideFailed: string
  time: string
  lessThanMinute: string
  minutes: (n: number) => string
  back: string
  empty: string
  hidden: (n: number) => string
  // table header of the table theme
  step: string
  result: string
  // summary line pieces: steps, open choices, blocked, deferred
  steps: (n: number) => string
  toDecide: (n: number) => string
  blockedN: (n: number) => string
  deferredN: (n: number) => string
  // commands
  flowDesc: string
  flowClearDesc: string
  flowThemeDesc: string
  flowOpened: string
  flowCleared: string
  fullscreenOn: string
  themeSet: (n: number, name: string) => string
  themePickerOpened: string
  themePickerTitle: string
  close: string
  current: string
  // btw
  btwLabel: string
  btwPlaceholder: string
  btwPending: string
  btwFailed: (why: string) => string
  // read by the model only
  viewing: (title: string, at: string) => string
}

// Short English names in every locale.
const THEMES = { 1: 'Cards', 2: 'Timeline', 3: 'Compact', 4: 'Cells', 5: 'Tree', 7: 'Table' }

const ko: Strings = {
  paneTitle: '작업 흐름',
  ok: '성공',
  blocked: '중단',
  deferred: '보류',
  chosen: '선택됨',
  themes: THEMES,
  problem: '문제',
  cause: '원인',
  attempt: n => `시도 ${n}`,
  reason: why => `이유: ${why}`,
  fix: '조치',
  fixAt: time => `조치 (${time} 해결)`,
  okReason: '넘어간 이유',
  notDone: '진행하지 못한 작업',
  resolvedRow: '해결',
  detail: '한 일',
  needsDecision: '결정 필요',
  decided: '결정됨',
  issue: '쟁점',
  meanwhile: '그동안',
  stepsAfter: k => `이 단계 뒤에 단계 ${k}개가 진행됐습니다`,
  decisionRow: '결정',
  decisionPrompt: (title, l, option, note, issue, id, at, k) =>
    `결정 (사용자가 step-flow 패널에서 직접 눌렀습니다): "${title}" (${at} 기록, 이후 단계 ${k}개) → ${l} (${option}: ${note}). 쟁점: ${issue}. 이미 기록했습니다 (${id}). 바꾸기 전에 지금 상태를 확인하세요. 이 단계가 이미 해결됐거나 이 선택이 뒤에 한 작업과 부딪히면 아무것도 바꾸지 말고, mcp__step-flow__decided를 이 id와 choice 0으로 호출해 선택을 다시 연 뒤 사용자에게 먼저 알리세요. 문제가 없으면 이 선택으로 진행하세요.`,
  goPrompt: (title, status, l, option, note, cause, id, at, k) =>
    `진행 (사용자가 step-flow 패널에서 직접 눌렀습니다): "${title}" (${status}, ${at} 기록, 이후 단계 ${k}개) → ${l} (${option}: ${note}). 원인: ${cause}. 이미 기록했습니다 (${id}). 바꾸기 전에 지금 상태를 확인하세요. 이 단계가 이미 해결됐거나 이 선택이 뒤에 한 작업과 부딪히면 아무것도 바꾸지 말고, mcp__step-flow__decided를 이 id와 choice 0으로 호출해 선택을 다시 연 뒤 사용자에게 먼저 알리세요. 문제가 없으면 이 방법으로 진행하세요. 고치면 이 id로 mcp__step-flow__resolve를 호출하세요.`,
  decideFailed: '결정을 보내지 못했습니다',
  time: '시각',
  lessThanMinute: '1분 미만',
  minutes: n => `${n}분`,
  back: '← 목록',
  empty: '아직 기록한 단계가 없습니다.',
  hidden: n => `앞선 ${n}개 단계는 숨겼습니다`,
  step: '단계',
  result: '결과',
  steps: n => `단계 ${n}개`,
  toDecide: n => `결정 필요 ${n}개`,
  blockedN: n => `중단 ${n}개`,
  deferredN: n => `보류 ${n}개`,
  flowDesc: '작업 흐름 패널 열기',
  flowClearDesc: '작업 흐름 기록 지우기',
  flowThemeDesc: '작업 흐름 패널 모양 바꾸기',
  flowOpened: '작업 흐름 패널을 열었습니다.',
  flowCleared: '작업 흐름 기록을 지웠습니다.',
  fullscreenOn: '패널을 오른쪽에 두기 위해 fullscreen 화면을 켰습니다. 다음 세션부터 적용됩니다.',
  themeSet: (n, name) => `테마를 ${n}번(${name})으로 바꿨습니다.`,
  themePickerOpened: '테마 목록을 패널에 띄웠습니다.',
  themePickerTitle: '테마 고르기',
  close: '닫기',
  current: 'current',
  btwLabel: '질문',
  btwPlaceholder: '세션 컨텍스트에는 영향이 가지 않는 대화입니다',
  btwPending: '답을 만드는 중입니다…',
  btwFailed: why => `답을 받지 못했습니다 (${why})`,
  viewing: (title, at) => `사용자가 보고 있는 단계: ${title} (${at})`,
}

const en: Strings = {
  paneTitle: 'Work flow',
  ok: 'Done',
  blocked: 'Blocked',
  deferred: 'Deferred',
  chosen: 'Chosen',
  themes: THEMES,
  problem: 'Problem',
  cause: 'Cause',
  attempt: n => `Attempt ${n}`,
  reason: why => `reason: ${why}`,
  fix: 'Fix',
  fixAt: time => `Fix (resolved ${time})`,
  okReason: 'Why OK',
  notDone: 'Not done',
  resolvedRow: 'Resolved',
  detail: 'Activity',
  needsDecision: 'Needs decision',
  decided: 'Decided',
  issue: 'Issue',
  meanwhile: 'Meanwhile',
  stepsAfter: k => `${k} steps were recorded after this one`,
  decisionRow: 'Decision',
  decisionPrompt: (title, l, option, note, issue, id, at, k) =>
    `Decision (the user pressed this in the step-flow pane): "${title}" (recorded ${at}, ${k} steps since) → ${l} (${option}: ${note}). Issue: ${issue}. Already recorded (${id}). Check the current state before changing anything. If this step is already fixed or this choice conflicts with work done after it, change nothing, call mcp__step-flow__decided with this id and choice 0 to reopen the choice, and tell the user first. Otherwise go on with this choice.`,
  goPrompt: (title, status, l, option, note, cause, id, at, k) =>
    `Go ahead (the user pressed this in the step-flow pane): "${title}" (${status}, recorded ${at}, ${k} steps since) → ${l} (${option}: ${note}). Cause: ${cause}. Already recorded (${id}). Check the current state before changing anything. If this step is already fixed or this choice conflicts with work done after it, change nothing, call mcp__step-flow__decided with this id and choice 0 to reopen the choice, and tell the user first. Otherwise go on with this choice. When it is fixed, call mcp__step-flow__resolve with this id.`,
  decideFailed: 'Could not send the decision',
  time: 'Time',
  lessThanMinute: 'under 1 min',
  minutes: n => `${n} min`,
  back: '← List',
  empty: 'No steps recorded yet.',
  hidden: n => `${n} earlier ${n === 1 ? 'step' : 'steps'} hidden`,
  step: 'Step',
  result: 'Result',
  steps: n => `${n} ${n === 1 ? 'step' : 'steps'}`,
  toDecide: n => `${n} to decide`,
  blockedN: n => `${n} blocked`,
  deferredN: n => `${n} deferred`,
  flowDesc: 'Open the work flow panel',
  flowClearDesc: 'Clear the work flow record',
  flowThemeDesc: 'Change the look of the work flow panel',
  flowOpened: 'Opened the work flow panel.',
  flowCleared: 'Cleared the work flow record.',
  fullscreenOn: 'Turned on the fullscreen layout so the pane docks on the right. Takes effect from the next session.',
  themeSet: (n, name) => `Theme set to ${n} (${name}).`,
  themePickerOpened: 'Theme list is open in the pane.',
  themePickerTitle: 'Choose a theme',
  close: 'Close',
  current: 'current',
  btwLabel: 'Question',
  btwPlaceholder: "A side chat that doesn't affect the session context",
  btwPending: 'Thinking…',
  btwFailed: why => `No answer received (${why})`,
  viewing: (title, at) => `Step the user is viewing: ${title} (${at})`,
}

export type Locale = 'ko' | 'en'
export const TABLES: Record<Locale, Strings> = { ko, en }

// First match wins; anything unmatched is English.
const LOCALES: [RegExp, Locale][] = [[/^\s*(한국어|korean|ko([-_.@].*)?)\s*$/i, 'ko']]

export const toLocale = (v: unknown): Locale =>
  (typeof v === 'string' && LOCALES.find(([re]) => re.test(v))?.[1]) || 'en'

export const tr = (locale: string): Strings => (TABLES as Record<string, Strings>)[locale] ?? en
