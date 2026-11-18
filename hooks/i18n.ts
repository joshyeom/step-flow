// A language is a table here plus one line in LOCALES.
export type Strings = {
  paneTitle: string
  // the two display results
  ok: string
  failed: string
  themes: Record<number, string>
  // field labels; the list views add ': '
  problem: string
  cause: string
  attempt: (n: number) => string
  reason: (why: string) => string
  fix: string
  unresolved: string
  detail: string
  time: string
  lessThanMinute: string
  minutes: (n: number) => string
  back: string
  empty: string
  hidden: (n: number) => string
  // table header of the table theme
  step: string
  result: string
  // summary line pieces: steps, then the failure count
  steps: (n: number) => string
  failedN: (n: number) => string
  // commands
  flowDesc: string
  flowClearDesc: string
  flowThemeDesc: string
  flowOpened: string
  flowCleared: string
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
  failed: '실패',
  themes: THEMES,
  problem: '문제',
  cause: '원인',
  attempt: n => `시도 ${n}`,
  reason: why => `이유: ${why}`,
  fix: '조치',
  unresolved: '미해결',
  detail: '상세',
  time: '시각',
  lessThanMinute: '1분 미만',
  minutes: n => `${n}분`,
  back: '← 목록',
  empty: '아직 기록한 단계가 없습니다.',
  hidden: n => `앞선 ${n}개 단계는 숨겼습니다`,
  step: '단계',
  result: '결과',
  steps: n => `단계 ${n}개`,
  failedN: n => `실패 ${n}개`,
  flowDesc: '작업 흐름 패널 열기',
  flowClearDesc: '작업 흐름 기록 지우기',
  flowThemeDesc: '작업 흐름 패널 모양 바꾸기',
  flowOpened: '작업 흐름 패널을 열었습니다.',
  flowCleared: '작업 흐름 기록을 지웠습니다.',
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
  failed: 'Failed',
  themes: THEMES,
  problem: 'Problem',
  cause: 'Cause',
  attempt: n => `Attempt ${n}`,
  reason: why => `reason: ${why}`,
  fix: 'Fix',
  unresolved: 'Unresolved',
  detail: 'Detail',
  time: 'Time',
  lessThanMinute: 'under 1 min',
  minutes: n => `${n} min`,
  back: '← List',
  empty: 'No steps recorded yet.',
  hidden: n => `${n} earlier ${n === 1 ? 'step' : 'steps'} hidden`,
  step: 'Step',
  result: 'Result',
  steps: n => `${n} ${n === 1 ? 'step' : 'steps'}`,
  failedN: n => `${n} failed`,
  flowDesc: 'Open the work flow panel',
  flowClearDesc: 'Clear the work flow record',
  flowThemeDesc: 'Change the look of the work flow panel',
  flowOpened: 'Opened the work flow panel.',
  flowCleared: 'Cleared the work flow record.',
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
