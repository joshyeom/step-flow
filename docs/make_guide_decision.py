#!/usr/bin/env python3
"""Writes docs/guide-decision-en.svg and docs/guide-decision-ko.svg (one template, two string tables).

Story: Claude works for hours, every finished step is added to the step-flow pane,
at the end Claude asks A or B, the user scrolls the pane up to the "Needs decision" step,
opens it and presses [ Choose A ].

Pure SVG + one <style> with @keyframes. Every animation uses the same 31 s duration, linear or steps,
infinite, keyframes in %, so beats never drift. Without animation (prefers-reduced-motion) the base
styles show the poster: pane scrolled up to the Needs-decision row, Claude's A/B question in the chat,
caption 4. All widths come from wpx(): 14 px for East Asian W/F chars, 8.4 px for the rest.
"""
import pathlib
import unicodedata
from html import escape

# ---- grid ---------------------------------------------------------------
CELL, LH = 8.4, 17            # 14 px monospace: 0.6 em wide, 17 px rows
W, TITLE_H = 900, 26
TOP = TITLE_H + 8             # first terminal row (8 px padding under the title bar)
X0 = 18                       # left padding
CHAT_COLS, PANE_COLS = 41, 62  # 41 + 62 = 103 cells (62: the list fields must fit before the result column)
PCW = PANE_COLS - 1           # pane content width (1 cell = border)
PX = X0 + CHAT_COLS * CELL    # pane left edge
WL = 16                       # rows between the close row and the summary
WR = WL - 2                   # step rows visible under the pinned header + rule (fewer than the 24 steps)
PR = 1 + WL + 4               # pane rows: close row, list window, summary, rule, question, blank
PROMPT_ROW = PR               # rule, input, rule
TERM_H = TOP + (PR + 3) * LH + 8
H = TERM_H + 54               # caption strip inside the same window
WRAP_CHAT = CHAT_COLS - 1
DUR = 31.0
RESET = 30.6                  # everything fades to the opening frame
EPS = 0.02

# xterm-256 colours from the captures
BG, PANE_BG, SUM_BG, QROW_BG = '#1c1c1c', '#262626', '#000000', '#3a3a3a'
FG, GRAY, RULE, GREEN, RED, FOCUS = '#d0d0d0', '#949494', '#4e4e4e', '#87d787', '#ff87af', '#afd7ff'
YELLOW, DIMB, PROMPT_RULE = '#ffd700', '#707070', '#808080'
WHITE = '#ffffff'


def cells(s):
    """Grid cells: East Asian W/F chars take 2."""
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in s)


EM = 14  # a Hangul/CJK glyph is about 1 em wide, not 2 x 8.4


def wpx(s):
    """Pixel width: 14 for East Asian W/F chars, 8.4 for the rest. Drives every x, textLength and rect width."""
    return sum(EM if unicodedata.east_asian_width(c) in 'WF' else CELL for c in s)


def n(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def wrap(s, w_first, w_rest=None):
    """Greedy wrap at spaces by pixel width."""
    w_rest = w_first if w_rest is None else w_rest
    lines, cur = [], ''
    for w in s.split(' '):
        cand = w if not cur else cur + ' ' + w
        if cur and wpx(cand) > (w_rest if lines else w_first):
            lines.append(cur)
            cur = w
        else:
            cur = cand
    return lines + [cur]


def cut(s, width):
    """Cut a string with an ellipsis (width in px)."""
    if wpx(s) <= width:
        return s
    while wpx(s + '…') > width:
        s = s[:-1]
    return s.rstrip() + '…'


# ---- animation registry -------------------------------------------------
KF = {}   # keyframe body -> class name


def pct(t):
    return n(t / DUR * 100).rstrip('.') + '%' if t not in (0, DUR) else ('0%' if t == 0 else '100%')


def kf(points):
    """points: [(t, 'decl', timing|None)]; returns the class that plays them."""
    pts = sorted(points, key=lambda p: p[0])
    out = []
    for p in pts:
        if out and out[-1][0] == p[0]:
            assert out[-1][1] == p[1], ('conflict at', p)
            continue
        out.append((p[0], p[1], p[2] if len(p) > 2 else None))
    assert out[0][0] == 0 and out[-1][0] == DUR, 'keyframes must pin 0% and 100%'
    body = ''.join(
        f'{pct(t)}{{{d}{";animation-timing-function:" + tm if tm else ""}}}' for t, d, tm in out)
    if body not in KF:
        KF[body] = f'a{len(KF)}'
    return KF[body]


def vis_points(wins):
    pts = {}

    def put(t, v):
        t = round(t, 3)
        assert pts.get(t, v) == v, ('vis conflict', t)
        pts[t] = v

    for w in wins:
        a, b = w[0], (w[1] if w[1] is not None else RESET)
        fa = w[2] if len(w) > 2 else (DUR - RESET if a == RESET else 0.15)
        fb = w[3] if len(w) > 3 else (DUR - RESET if b == RESET else 0.15)
        if a <= 0:
            put(0, 1)
        else:
            put(a, 0)
            put(a + fa, 1)
        if w[1] == DUR:
            put(DUR, 1)
        else:
            put(b, 1)
            put(b + fb, 0)
    pts.setdefault(0, 0)
    pts.setdefault(DUR, 0)
    return [(t, f'opacity:{v}') for t, v in pts.items()]


def g(inner, wins=None, hidden=True, extra=''):
    """Group with a visibility animation. hidden = not part of the poster."""
    cls = []
    if wins is not None:
        cls.append(kf(vis_points(wins)))
    if hidden:
        cls.append('h')
    c = f' class="{" ".join(cls)}"' if cls else ''
    return f'<g{c}{extra}>{inner}</g>'


# ---- primitives ---------------------------------------------------------
def rect(x, y, w, h, fill, extra=''):
    return f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" fill="{fill}"{extra}/>'


def text(x, y, s, fill, bold=False, extra=''):
    assert s == s.strip() and s, repr(s)
    b = ' font-weight="700"' if bold else ''
    return (f'<text x="{n(x)}" y="{n(y)}" textLength="{n(wpx(s))}" lengthAdjust="spacing" '
            f'fill="{fill}"{b}{extra}>{escape(s, quote=False)}</text>')


def runs(x, row_y, pieces):
    """pieces: [(string, fill, bold)] laid out back to back by pixel width."""
    out, cx = [], x
    for s, fill, bold in pieces:
        lead = len(s) - len(s.lstrip(' '))
        t = s.strip(' ')
        if t:
            out.append(text(cx + lead * CELL, row_y + 12.5, t, fill, bold))
        cx += wpx(s)
    return ''.join(out)


def ry(row):
    return TOP + row * LH


def chat_x(col):
    return X0 + col * CELL


def pane_x(col):          # content column inside the pane
    return PX + (1 + col) * CELL


def hline(x, y, w, color):
    return f'<line x1="{n(x)}" y1="{n(y)}" x2="{n(x + w)}" y2="{n(y)}" stroke="{color}" stroke-width="1"/>'


def typed(x, row, s, t0, t1, wins, bg, extra_after=''):
    """Typing: text under a cover rect that slides right; block caret on its edge.
    Keyframe stops sit at each char's cumulative width with step-end timing, so mixed
    Latin/Korean runs reveal whole glyphs. The nested <svg> clips the cover to the run."""
    w, N = wpx(s), len(s)
    hide = max(w_[1] if w_[1] is not None else RESET for w_ in wins) + 0.3
    pts = [(t0 + (t1 - t0) * k / N, f'transform:translateX({n(wpx(s[:k]))}px)', 'steps(1,end)') for k in range(N + 1)]
    key = kf([(0, 'transform:translateX(0)', 'steps(1,end)')] + pts
             + [(hide, f'transform:translateX({n(w)}px)', 'steps(1,end)'), (hide + EPS, 'transform:translateX(0)'),
                (DUR, 'transform:translateX(0)')])
    inner = (f'<svg x="{n(x)}" y="{n(ry(row))}" width="{n(w + CELL)}" height="{LH}" overflow="hidden">'
             + text(0, 12.5, s, FG)
             + rect(0, 0, w, LH, bg, f' class="{key}"')
             + rect(0, 1, CELL, LH - 2, FG, f' class="{key}"') + '</svg>')
    return g(inner + extra_after, wins)




# ---- string tables ------------------------------------------------------
# step rows: (time, title, key) key = ok | need | defer
EN = dict(
    lang='en',
    title='step-flow: a side pane that lists every step Claude finished and asks for your decision',
    desc=('Animated demo. Run /flow to open the pane. Over hours, each finished step is added to the list, with '
          'a deferred step showing why it is fine to skip and a step that needs a decision in yellow. Claude asks whether to use A or B. '
          'Scroll the pane up, click the step to see its details, and press Choose A in the pane to send the '
          'choice to Claude.'),
    caps=['Open the pane with /flow.',
          'As Claude works for hours, each finished step is added to the pane.',
          'Hours later, Claude asks whether to go with A or B.',
          'Scroll the pane up to find the step marked "Needs decision".',
          'Click it to see the issue and each option.',
          'Click "Choose A". Claude continues with A, and the step shows "Decided".'],
    opened='step-flow: Opened the work flow panel.',
    steps=[('10:02', 'Read the project structure', 'ok'), ('10:09', 'Set up the database schema', 'ok'),
           ('10:21', 'Build the sign-up API', 'ok'), ('10:34', 'Add email verification', 'ok'),
           ('10:48', 'Write sign-up tests', 'ok'), ('11:02', 'Add password reset', 'ok'),
           ('11:17', 'Set up error logging', 'ok'), ('11:29', 'Write the payment spec', 'ok'),
           ('11:42', 'Choose the payment provider', 'need'), ('11:55', 'Build the login screen', 'ok'),
           ('12:08', 'Add session refresh', 'ok'), ('12:15', 'Toss overseas card test', 'defer'),
           ('12:24', 'Add social login', 'ok'), ('12:36', 'Build the profile page', 'ok'),
           ('12:47', 'Upload profile images', 'ok'), ('12:58', 'Build the dashboard layout', 'ok'),
           ('13:06', 'Add usage charts', 'ok'), ('13:12', 'Fix chart timezone bug', 'ok'),
           ('13:18', 'Add CSV export', 'ok'), ('13:23', 'Write dashboard tests', 'ok'),
           ('13:27', 'Speed up the dashboard query', 'ok'), ('13:31', 'Add empty states', 'ok'),
           ('13:35', 'Update the README', 'ok'), ('13:38', 'Run the full test suite', 'ok')],
    h_time='Time', h_step='Step', h_result='Result',
    res=dict(ok='Done', need='Needs decision', defer='Deferred', dec='Decided'),
    defer_fields=[('Cause: ', 'Sandbox rejects overseas cards'), ('Why OK: ', 'Only matters if Toss is chosen')],
    after=lambda k: f'{k} steps were recorded after this one',
    empty='No steps recorded yet.',
    back='[ ← List ]', badge_need='Needs decision', badge_dec='Decided',
    dur='11:29 ~ 11:42 (13 min)',
    l_issue='Issue', l_a='A', l_b='B', l_meanwhile='Meanwhile', l_decision='Decision',
    issue='How to handle overseas cards must be decided',
    opt_a='Stripe', note_a='Takes overseas cards, 3.4% fee',
    opt_b='Toss Payments', note_b='Lower domestic fee, no overseas cards',
    meanwhile='Payment screen postponed; building login first',
    btns=('[ Choose A ]', '[ Choose B ]'), decision='A · 13:40',
    sum=lambda s, k, m, j: (f' {s} {"step" if s == 1 else "steps"}, ', f'{k} to decide', ', ', f'{m} blocked', ', ',
                            f'{j} deferred'),
    qlabel='Question: ', qph="A side chat that doesn't affect the session context",
    msg='Should I go with A or B?',
    note='Prompt from the step-flow plugin',
    prompt=('Decision (the user pressed this in the step-flow pane): "Choose the payment provider" '
            '(recorded 11:42, 15 steps since) → A (Stripe: …'),
    reply='Going with Stripe. Starting the payment screen.',
)
KO = dict(
    lang='ko',
    title='step-flow: Claude가 끝낸 단계를 모두 옆 패널에 모으고 결정이 필요한 일을 알려 줍니다',
    desc=('애니메이션 데모입니다. /flow로 패널을 엽니다. 몇 시간 동안 끝낸 단계가 쌓이고, 보류한 단계에는 '
          '넘어간 이유가, 결정이 필요한 단계는 노란색으로 보입니다. Claude가 A와 B 중 무엇으로 할지 묻습니다. 패널을 '
          '위로 올려 그 단계를 눌러 상세 화면을 보고, 패널에서 A로 결정을 누르면 선택이 Claude에게 전달됩니다.'),
    caps=['/flow로 패널을 엽니다.',
          'Claude가 몇 시간 작업하는 동안 끝낸 단계가 패널에 추가됩니다.',
          '몇 시간 뒤 Claude가 A와 B 중 무엇으로 할지 묻습니다.',
          '패널을 위로 스크롤해 "결정 필요" 단계를 찾습니다.',
          '단계를 누르면 쟁점과 선택지가 나옵니다.',
          '"A로 결정"을 누르면 Claude가 A로 작업을 계속하고, 단계 상태가 "결정됨"으로 바뀝니다.'],
    opened='step-flow: 작업 흐름 패널을 열었습니다.',
    steps=[('10:02', '프로젝트 구조 파악', 'ok'), ('10:09', 'DB 스키마 작성', 'ok'),
           ('10:21', '회원가입 API 구현', 'ok'), ('10:34', '이메일 인증 추가', 'ok'),
           ('10:48', '회원가입 테스트 작성', 'ok'), ('11:02', '비밀번호 재설정 추가', 'ok'),
           ('11:17', '에러 로깅 설정', 'ok'), ('11:29', '결제 요구사항 정리', 'ok'),
           ('11:42', '결제 모듈 선택', 'need'), ('11:55', '로그인 화면 구현', 'ok'),
           ('12:08', '세션 갱신 추가', 'ok'), ('12:15', '토스 해외 카드 테스트', 'defer'),
           ('12:24', '소셜 로그인 추가', 'ok'), ('12:36', '프로필 화면 구현', 'ok'),
           ('12:47', '프로필 이미지 업로드', 'ok'), ('12:58', '대시보드 레이아웃 구현', 'ok'),
           ('13:06', '사용량 차트 추가', 'ok'), ('13:12', '차트 시간대 버그 수정', 'ok'),
           ('13:18', 'CSV 내보내기 추가', 'ok'), ('13:23', '대시보드 테스트 작성', 'ok'),
           ('13:27', '대시보드 쿼리 개선', 'ok'), ('13:31', '빈 화면 처리', 'ok'),
           ('13:35', 'README 갱신', 'ok'), ('13:38', '전체 테스트 실행', 'ok')],
    h_time='시각', h_step='단계', h_result='결과',
    res=dict(ok='성공', need='결정 필요', defer='보류', dec='결정됨'),
    defer_fields=[('원인: ', '테스트 환경이 해외 카드를 거절함'), ('넘어간 이유: ', '토스를 고를 때만 상관있음')],
    after=lambda k: f'이 단계 뒤에 단계 {k}개가 진행됐습니다',
    empty='아직 기록한 단계가 없습니다.',
    back='[ ← 목록 ]', badge_need='결정 필요', badge_dec='결정됨',
    dur='11:29 ~ 11:42 (13분)',
    l_issue='쟁점', l_a='A', l_b='B', l_meanwhile='그동안', l_decision='결정',
    issue='해외 카드 결제를 어떻게 처리할지 정해야 함',
    opt_a='Stripe', note_a='해외 카드 지원, 수수료 3.4%',
    opt_b='토스페이먼츠', note_b='국내 수수료 낮음, 해외 카드 안 됨',
    meanwhile='결제 화면은 미루고 로그인부터 진행',
    btns=('[ A로 결정 ]', '[ B로 결정 ]'), decision='A · 13:40',
    sum=lambda s, k, m, j: (f' 단계 {s}개, ', f'결정 필요 {k}개', ', ', f'중단 {m}개', ', ', f'보류 {j}개'),
    qlabel='질문: ', qph='세션 컨텍스트에는 영향이 가지 않는 대화입니다',
    msg='A와 B 중 어떤 걸로 할까요?',
    note='Prompt from the step-flow plugin',
    prompt=('결정 (사용자가 step-flow 패널에서 직접 눌렀습니다): "결제 모듈 선택" '
            '(11:42 기록, 이후 단계 15개) → A (Stripe: …'),
    reply='Stripe로 진행합니다. 결제 화면부터 만들겠습니다.',
)


# ---- template -----------------------------------------------------------
def build(S):
    KF.clear()
    out = []
    add = out.append
    steps = S['steps']
    NS = len(steps)
    NEED = [i for i, s in enumerate(steps) if s[2] == 'need'][0]
    DEFER = [i for i, s in enumerate(steps) if s[2] == 'defer'][0]
    RES_COL = {'ok': GREEN, 'need': YELLOW, 'defer': GRAY, 'dec': GREEN}

    # timeline (seconds)
    t_type, t_enter = (0.3, 1.0), 1.2
    t_pane = (1.5, 2.1)
    ta = [2.7 + i * 0.33 for i in range(NS)]          # one row every 0.33 s
    t_msg = 11.2
    t_cur = 14.0
    ticks = [(15.5, 14), (15.95, 11), (16.4, 8), (16.85, 5), (17.3, 3)]  # wheel ticks: hidden lines above after each
    t_press1, t_list_off, t_det_on = 19.0, 19.25, 19.35
    t_press2, td = 24.5, 24.65                        # press Choose A / decision lands
    s_poster = ticks[-1][1]

    # window frame
    add(f'<rect width="{W}" height="{H}" rx="12" fill="{BG}"/>')
    add(f'<path d="M0 {TITLE_H}V12a12 12 0 0 1 12-12H{W - 12}a12 12 0 0 1 12 12V{TITLE_H}Z" fill="#242424"/>')
    for i, c in enumerate(('#ff5f57', '#febc2e', '#28c840')):
        add(f'<circle cx="{18 + i * 20}" cy="13" r="6" fill="{c}"/>')
    add(f'<path d="M0 {TERM_H}H{W}V{H - 12}a12 12 0 0 1-12 12H12a12 12 0 0 1-12-12Z" fill="#141414"/>')
    add(hline(0, TERM_H + 0.5, W, '#2a2a2a'))

    # prompt box: full width under chat and pane
    full = (CHAT_COLS + PANE_COLS) * CELL
    add(hline(X0, ry(PROMPT_ROW) + LH / 2, full, PROMPT_RULE))
    add(text(chat_x(0), ry(PROMPT_ROW + 1) + 12.5, '❯', FG))
    add(hline(X0, ry(PROMPT_ROW + 2) + LH / 2, full, PROMPT_RULE))
    add(typed(chat_x(2), PROMPT_ROW + 1, '/flow', *t_type, [(0.2, t_enter)], BG))

    # ---- chat column: one scrolling transcript, dim except markers
    cw = WRAP_CHAT * CELL
    blocks = []   # (time, lines, hidden); line = (pieces, bg)

    def user(text_):
        ls = wrap(text_, cw - 2 * CELL)
        if len(ls) > 2:
            ls = [ls[0], cut(ls[1] + ' ' + ' '.join(ls[2:]), cw - 2 * CELL)]
        return [([('❯' if j == 0 else ' ', GRAY, False), (' ' + l, GRAY, False)], True) for j, l in enumerate(ls)]

    def asst(text_, mark=FG, color=GRAY):
        ls = wrap(text_, cw - 2 * CELL)
        return [([('⏺' if j == 0 else ' ', mark, False), (' ' + l, color, False)], False) for j, l in enumerate(ls)]

    blocks.append((1.3, [([('❯', GRAY, False), (' /flow', GRAY, False)], True),
                         ([('  ⎿  ', GRAY, False), (S['opened'], GRAY, False)], False), ([], False)], False))
    for i, (_, title, _k) in enumerate(steps):
        ls = asst(f'step-flow - step (MCP)(title: "{title}")', GREEN)
        assert len(ls) <= 2, ls
        blocks.append((ta[i] - 0.1, ls + [([('  ⎿  ', GRAY, False), ('recorded', GRAY, False)], False), ([], False)], False))
    blocks.append((t_msg, asst(S['msg'], WHITE, WHITE) + [([], False)], False))  # the only bright chat line
    blocks.append((td + 0.5, [([('› ' + S['note'], GRAY, False)], False)] + user(S['prompt']) + [([], False)], True))
    blocks.append((td + 1.6, asst(S['reply']), True))
    total, offs, body = 0, [], ''
    for k, (t, lines, hid) in enumerate(blocks):
        b = ''
        for j, (pieces, bg) in enumerate(lines):
            yy = (total + j) * LH
            if bg:
                b += rect(0, yy, sum(wpx(p[0]) for p in pieces) + CELL, LH, QROW_BG)
            if pieces:
                b += runs(0, yy, pieces)
        total += len(lines)
        offs.append((t, max(0, total - PR) * LH))
        body += g(b, [(t, None, 0.08)], hidden=hid)
    base_chat = [o for (t, o) in offs if t <= t_msg][-1]
    ev = [(t, o) for (t, o) in offs if o > 0]
    pts, prev = [(0, 'transform:translateY(0)')], 0
    for t, o in ev:
        if o != prev:
            pts += [(t, f'transform:translateY({-prev}px)'), (t + 0.1, f'transform:translateY({-o}px)')]
            prev = o
    pts += [(DUR - EPS, f'transform:translateY({-prev}px)'), (DUR, 'transform:translateY(0)')]
    add(f'<svg x="{X0}" y="{TOP}" width="{n(CHAT_COLS * CELL)}" height="{PR * LH}" overflow="hidden">'
        f'<g class="{kf(pts)}" style="transform:translateY({-base_chat}px)">{body}</g></svg>')

    # ---- pane
    X = pane_x(0)
    p = [rect(PX, TOP, PANE_COLS * CELL, PR * LH, PANE_BG),
         rect(PX + CELL / 2 - 0.75, TOP, 1.5, PR * LH, DIMB),
         text(pane_x(PCW - 2), ry(0) + 12.5, '✕', GRAY)]

    # list view: header + rule pinned on the first two rows, step rows scroll in their own window under them
    res_w = max(wpx(v) for v in S['res'].values())
    res_x = (PCW - 6) * CELL - res_w                      # right room for the ↑ N / ↓ N marks
    field_w = PCW * CELL - 7 * CELL - res_w - 2 * CELL    # fields must end before the result column
    head = (text(X, ry(1) + 12.5, S['h_time'], GRAY) + text(X + 7 * CELL, ry(1) + 12.5, S['h_step'], GRAY)
            + text(X + res_x, ry(1) + 12.5, S['h_result'], GRAY) + hline(X, ry(2) + LH / 2, PCW * CELL, RULE))
    rows = [g(text(0, 12.5, S['empty'], GRAY), [(t_pane[0], ta[0], 0.1, 0.1)])]
    heights = [1 + (5 if key == 'defer' else 0) for _, _, key in steps]   # a deferred step lists its fields
    first = [sum(heights[:i]) for i in range(NS)]          # first line of each step in the list
    after = [first[i] + heights[i] for i in range(NS)]     # list length once step i has arrived
    LT = after[-1]
    for i, (tm, title, key) in enumerate(steps):
        yy = first[i] * LH
        r = text(0, yy + 12.5, tm, GRAY) + text(7 * CELL, yy + 12.5, title, FG)
        r += text(res_x, yy + 12.5, S['res'][key], RES_COL[key], True)
        if key == 'defer':
            for j, (lab, val) in zip((2, 4), S['defer_fields']):
                assert wpx(lab + val) <= field_w + 0.01, (lab + val, wpx(lab + val), field_w)
                r += runs(7 * CELL, yy + j * LH, [(lab, GRAY, False), (val, FG, False)])
        rows.append(g(r, [(ta[i], None, 0.1)], hidden=False))
    # Once the list is taller than its window it gets a ═ cap row at its very start and very end (rows: ↑ N / ↓ N
    # count them). Content coordinates exclude the start cap, so while capped the content sits one line lower:
    # shift (1 - s) with s = hidden lines above. The window follows the end, so only the end cap shows; the
    # scroll-up never reaches the very top (s stays > 0), so the start cap never shows.
    def cap(line):
        y = line * LH + LH / 2
        return hline(0, y - 1.5, PCW * CELL, RULE) + hline(0, y + 1.5, PCW * CELL, RULE)
    top_ev = []                                            # (time, shift in lines)
    caps = []                                              # end cap per arrival once the list overflows
    for i in range(NS):
        if after[i] > WR:
            t_end = ta[i + 1] if i + 1 < NS else None
            caps.append(g(cap(after[i]), [(ta[i], t_end, 0.05, 0.05)], hidden=True))
            top_ev.append((ta[i], 1 - (after[i] + 2 - WR)))
    s_end = after[-1] + 2 - WR
    top_ev += [(t, 1 - s) for t, s in ticks]
    rows += caps
    pts, prev = [(0, 'transform:translateY(0)')], 0
    for t, sh in top_ev:
        pts += [(t, f'transform:translateY({prev * LH}px)'), (t + 0.12, f'transform:translateY({sh * LH}px)')]
        prev = sh
    pts += [(DUR - EPS, f'transform:translateY({prev * LH}px)'), (DUR, 'transform:translateY(0)')]
    lst = (f'<svg x="{n(X)}" y="{ry(3)}" width="{n(PCW * CELL)}" height="{WR * LH}" overflow="hidden">'
           f'<g class="{kf(pts)}" style="transform:translateY({(1 - s_poster) * LH}px)">{"".join(rows)}</g></svg>')
    # the 11:42 row must be out of view at the end, and mid-window where the scroll-up settles
    assert first[NEED] + 1 < s_end, (first[NEED], s_end)
    assert abs((first[NEED] + 1 - s_poster) - (WR - 1) // 2) <= 1, (first[NEED] + 1 - s_poster, WR)
    assert first[DEFER] + 1 - s_poster < WR - 1, 'the deferred block starts below 11:42 inside the window'
    assert s_poster > 0, 'the scroll-up must not reach the start cap'
    # ↑ N / ↓ N count hidden ROWS incl. the caps (a deferred step is several rows), at the right end of the first / last visible row
    states = [(ta[i], after[i] + 2 - WR, after[i] + 2) for i in range(NS) if after[i] > WR] + \
             [(t, s, after[-1] + 2) for t, s in ticks]
    ups, downs = {}, {}
    for j, (t, s, L) in enumerate(states):
        t_end = states[j + 1][0] if j + 1 < len(states) else None
        if s > 0:
            ups.setdefault(s, []).append((t, t_end, 0.05, 0.05))
        d = L - s - WR
        if d > 0:
            downs.setdefault(d, []).append((t, t_end, 0.05, 0.05))
    marks = ''
    for v, wins in ups.items():
        s_ = f'↑ {v}'
        marks += g(text(X + PCW * CELL - wpx(s_), ry(3) + 12.5, s_, GRAY), wins, hidden=(v != s_poster))
    for v, wins in downs.items():
        s_ = f'↓ {v}'
        marks += g(text(X + PCW * CELL - wpx(s_), ry(2 + WR) + 12.5, s_, GRAY),
                   wins, hidden=(v != LT + 2 - s_poster - WR))
    p.append(g(head + lst + marks, [(t_pane[0], t_list_off, 0.1, 0.1)], hidden=False))

    # detail view of the decision (pending -> decided)
    labels = [S['l_issue'], S['l_a'], S['l_b'], S['l_meanwhile'], S['l_decision']]
    vx = max(wpx(l) for l in labels) + 2 * CELL

    def line(j):
        return ry(1 + j)

    def badge(label, color):
        bw = wpx(' ' + label + ' ')
        return (rect(X, line(2), bw, LH, color) + text(X + CELL, line(2) + 12.5, label, PANE_BG, True)
                + text(X + bw + CELL, line(2) + 12.5, steps[NEED][1], FG, True))

    def opt(j, lab, name, note, c_lab, c_name, c_note, mark=''):
        return (text(X, line(j) + 12.5, lab, c_lab) + text(X + vx, line(j) + 12.5, mark + name, c_name, True)
                + text(X + vx, line(j + 1) + 12.5, note, c_note))

    det = [text(X, line(0) + 12.5, S['back'], FG, True),
           text(X, line(3) + 12.5, S['dur'], GRAY), hline(X, line(4) + LH / 2, PCW * CELL, RULE),
           text(X, line(5) + 12.5, S['l_issue'], GRAY), text(X + vx, line(5) + 12.5, S['issue'], FG),
           text(X, line(12) + 12.5, S['l_meanwhile'], GRAY), text(X + vx, line(12) + 12.5, S['meanwhile'], FG)]
    k_after = NS - 1 - NEED
    pend = (badge(S['badge_need'], YELLOW)
            + opt(7, S['l_a'], S['opt_a'], S['note_a'], GRAY, FG, GRAY)
            + opt(9, S['l_b'], S['opt_b'], S['note_b'], GRAY, FG, GRAY)
            + text(X, line(14) + 12.5, S['after'](k_after), GRAY)
            + runs(X, line(15), [(S['btns'][0], FG, True), ('  ', FG, False), (S['btns'][1], FG, True)]))
    done = (badge(S['badge_dec'], GREEN)
            + opt(7, S['l_a'], S['opt_a'], S['note_a'], GREEN, GREEN, GREEN, '✓ ')
            + opt(9, S['l_b'], S['opt_b'], S['note_b'], GRAY, GRAY, GRAY)
            + text(X, line(14) + 12.5, S['l_decision'], GREEN) + text(X + vx, line(14) + 12.5, S['decision'], GREEN))
    det.append(g(pend, [(0, td, 0, 0.12)], hidden=False))
    det.append(g(done, [(td, None, 0.12)]))
    p.append(g(''.join(det), [(t_det_on, None, 0.25)]))

    # footer, pinned: summary, rule, question input (never focused in this story)
    def summary(sn, k, m, j):
        parts = S['sum'](sn, k, m, j)
        cols = [FG, YELLOW if k else GREEN, FG, RED if m else GREEN, FG, GRAY if j else GREEN]
        return (rect(X, ry(1 + WL), wpx(''.join(parts)), LH, SUM_BG)
                + runs(X, ry(1 + WL), [(t_, c_, False) for t_, c_ in zip(parts, cols)]))

    p.append(g(summary(0, 0, 0, 0), [(t_pane[0], ta[0], 0.08, 0.08)]))
    for i in range(NS):
        k, j = int(i >= NEED), int(i >= DEFER)
        last = i == NS - 1
        p.append(g(summary(i + 1, k, 0, j), [(ta[i], td if last else ta[i + 1], 0.08, 0.08)], hidden=not last))
    p.append(g(summary(NS, 0, 0, 1), [(td, None, 0.12)]))
    p.append(hline(X, ry(2 + WL) + LH / 2, PCW * CELL, RULE))
    qph = cut(S['qph'], PCW * CELL - wpx(S['qlabel']))
    p.append(runs(X, ry(3 + WL), [(S['qlabel'], FG, False), (qph, GRAY, False)]))

    pane_cls = kf([(0, 'opacity:0;transform:translateX(120px)'), (t_pane[0], 'opacity:0;transform:translateX(120px)'),
                   (t_pane[1], 'opacity:1;transform:translateX(0)'), (RESET, 'opacity:1;transform:translateX(0)'),
                   (DUR, 'opacity:0;transform:translateX(0)')])
    add(f'<g class="{pane_cls}">{"".join(p)}</g>')

    # ---- cursor (outer: show/hide, middle: position, inner: press)
    def at(x, y):
        return f'transform:translate({n(x)}px,{n(y)}px)'
    start = at(PX + 40 * CELL, ry(12))
    on_list = at(pane_x(36), ry(8) + 9)
    on_title = at(pane_x(9), ry(9) + 9)
    on_btn = at(pane_x(5), ry(16) + 9)
    pos = kf([(0, start), (t_cur, start), (15.1, on_list), (17.5, on_list), (18.4, on_title), (23.3, on_title),
              (24.2, on_btn), (DUR, on_btn)])
    press = kf([(0, 'transform:scale(1)'), (t_press1, 'transform:scale(1)'), (t_press1 + 0.1, 'transform:scale(.88)'),
                (t_press1 + 0.25, 'transform:scale(1)'), (t_press2, 'transform:scale(1)'),
                (t_press2 + 0.1, 'transform:scale(.88)'), (t_press2 + 0.25, 'transform:scale(1)'),
                (DUR, 'transform:scale(1)')])
    arrow = ('<path d="M0 0V15l3.9-3.6 2.7 6.3 2.4-1-2.6-6.2h5.2Z" fill="#ffffff" stroke="#000000" '
             'stroke-width="1" stroke-linejoin="round"/>')
    add(g(f'<g class="{pos}"><g class="{press} pr">{arrow}</g></g>', [(t_cur, 25.6)]))

    # ---- captions
    wins = [[(0, 2.5), (RESET, DUR)], [(2.5, 11.0)], [(11.0, 14.0)], [(14.0, 19.0)], [(19.0, 23.0)],
            [(23.0, RESET - 0.2, 0.15, 0.2)]]
    cy = TERM_H + (H - TERM_H) / 2
    for i, cap in enumerate(S['caps']):
        body = (f'<circle cx="{X0 + 11}" cy="{n(cy)}" r="11" fill="#2b2b2b"/>'
                f'<text class="cap" x="{X0 + 11}" y="{n(cy + 4.5)}" text-anchor="middle" fill="{FOCUS}" '
                f'font-weight="700">{i + 1}</text>'
                f'<text class="cap" x="{X0 + 34}" y="{n(cy + 5)}" fill="{FG}">{escape(cap, quote=False)}</text>')
        add(g(body, wins[i], hidden=(i != 3)))

    css = ('svg{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,\'Liberation Mono\',monospace}'
           'text{font-size:14px;white-space:pre}.cap{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
           '\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif}.h{opacity:0}'
           '.pr{transform-box:fill-box;transform-origin:center}'
           + ''.join(f'.{c}{{animation:k{c[1:]} {DUR:g}s linear infinite both}}' for c in KF.values())
           + ''.join(f'@keyframes k{c[1:]}{{{b}}}' for b, c in KF.items())
           + '@media (prefers-reduced-motion:reduce){*{animation:none !important}}')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {n(H)}" width="{W}" height="{n(H)}" '
            f'role="img" lang="{S["lang"]}"><title>{escape(S["title"], quote=False)}</title>'
            f'<desc>{escape(S["desc"], quote=False)}</desc><style>{css}</style>' + ''.join(out) + '</svg>\n')


if __name__ == '__main__':
    assert cells('E2E 테스트') == 10 and cells('/flow') == 5 and wpx('E2E 테스트') == 4 * CELL + 3 * EM
    here = pathlib.Path(__file__).parent
    for S in (EN, KO):
        (here / f'guide-decision-{S["lang"]}.svg').write_text(build(S), encoding='utf-8')
