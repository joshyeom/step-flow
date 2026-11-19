#!/usr/bin/env python3
"""Writes docs/guide-basic-en.svg and docs/guide-basic-ko.svg (one template, two string tables).

Pure SVG + one <style> with @keyframes. Every animation is 22 s, linear or steps,
infinite, with keyframes in %, so the beats never drift. Without animation
(prefers-reduced-motion) the base styles show the poster: the list with the blocked
step expanded, caption 2 only. UI = step-flow v0.3 (a blocked step shows its fields in the
list, four summary counts, pinned header and footer, detail view with Activity).
"""
import pathlib
import unicodedata
from html import escape

# ---- grid ---------------------------------------------------------------
CELL, LH = 8.4, 17            # 14 px monospace: 0.6 em wide, 17 px rows
W, TITLE_H = 900, 26
TOP = TITLE_H + 8             # first terminal row (8 px padding under the title bar)
X0 = 18                       # left padding
CHAT_COLS, PANE_COLS = 44, 59  # 44 + 59 = 103 cells
PCW = PANE_COLS - 1           # pane content width (1 cell = border)
PX = X0 + CHAT_COLS * CELL    # pane left edge
PR = 25                       # pane rows: close row, 20 body rows, summary, rule, question, blank
PROMPT_ROW = PR               # rule, input, rule
TERM_H = TOP + (PR + 3) * LH + 8
H = TERM_H + 54               # caption strip inside the same window
WIN = PR - 6                  # detail scroll window rows (under the pinned [ ← List ] row)
WRAP_CHAT = CHAT_COLS - 1
DUR = 22.0
RESET = 21.6                  # everything fades to the opening frame
EPS = 0.02

# xterm-256 colours from the captures
BG, PANE_BG, SUM_BG, QROW_BG = '#1c1c1c', '#262626', '#000000', '#3a3a3a'
FG, GRAY, RULE, GREEN, RED, FOCUS = '#d0d0d0', '#949494', '#4e4e4e', '#87d787', '#ff87af', '#afd7ff'
DIMB, PROMPT_RULE = '#707070', '#808080'


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
EN = dict(
    lang='en',
    title='step-flow: a side pane that lists the steps Claude finished',
    desc=('Animated demo in four steps. Run /flow to open the pane. Finished steps appear in it, and a blocked '
          'step shows its cause and the work that was not done. Click a step to see what Claude tried '
          'and which commands it ran. Ask a question in the pane without changing your current conversation.'),
    caps=['Open the pane with /flow.',
          'Finished steps appear in the pane. If a step is blocked, you can see why and what was left undone.',
          'Click a step to see what Claude tried and which commands it ran.',
          'Ask about the work here without affecting your current conversation.'],
    task='Add a login page and run the E2E tests',
    opened='step-flow: Opened the work flow panel.',
    working='Working…',
    tools=[('Read the auth config', 'done'), ('Add the login form', 'done'), ('Run the E2E tests', 'blocked')],
    tool_extra=['', '', ', …'],
    steps=['Read the auth config', 'Add the login form', 'Run the E2E tests'],
    times=['10:10', '10:11', '10:12'],
    h_time='Time', h_step='Step', h_result='Result', ok='Done', blocked='Blocked',
    res_all=['Done', 'Blocked', 'Needs decision', 'Decided', 'Deferred'],
    empty='No steps recorded yet.',
    cause_l='Cause', notdone_l='Not done', items=['Login E2E check', 'Sign-up E2E check'],
    attempt_l='Attempt 1',
    cause='Login timed out after 30 s', attempt='Raised the wait to 60 s',
    reason='reason: CI may be slow',
    sep=': ',
    back='[ ← List ]', dur='10:11 ~ 10:12 (1 min)',
    sum=lambda s, k, m, j: (f' {s} {"step" if s == 1 else "steps"}, ', f'{k} to decide', ', ', f'{m} blocked', ', ',
                            f'{j} deferred'),
    detail_l='Detail', act_l='Activity',
    acts=['Bash pnpm test:e2e', 'Edit playwright.config.ts', 'Bash pnpm test:e2e'],
    detail='Ran pnpm test:e2e twice; both runs stopped at the login page after the wait ran out.',
    qlabel='Question: ', qph="A side chat that doesn't affect the session context",
    question='Why did the E2E test fail?', thinking='Thinking…',
    answer=('The login page timed out after 30 s. Raising the wait to 60 s did not help, so the step is '
            'blocked and both E2E checks are still not done.'),
)
KO = dict(
    lang='ko',
    title='step-flow: Claude가 끝낸 단계를 옆 패널에 모아 보여 줍니다',
    desc=('네 단계로 보는 데모입니다. /flow로 패널을 엽니다. 끝낸 단계가 패널에 표시되고, 중단된 단계에는 원인과 '
          '진행하지 못한 작업이 나옵니다. 단계를 누르면 시도한 방법과 실행한 명령을 볼 수 있습니다. 패널에서 질문해도 '
          '기존 대화에는 영향이 없습니다.'),
    caps=['/flow로 패널을 엽니다.',
          '끝난 단계는 패널에 표시됩니다. 단계가 중단되면 왜 멈췄는지, 어떤 작업을 진행하지 못했는지 목록에서 바로 볼 수 있습니다.',
          '단계를 누르면 시도한 방법과 실행한 명령을 볼 수 있습니다.',
          '패널에서 작업 내용을 물어봐도 기존 대화에는 영향을 주지 않습니다.'],
    task='로그인 페이지를 추가하고 E2E 테스트를 실행해 줘',
    opened='step-flow: 작업 흐름 패널을 열었습니다.',
    working='작업 중…',
    tools=[('인증 설정 읽기', 'done'), ('로그인 폼 추가', 'done'), ('E2E 테스트 실행', 'blocked')],
    tool_extra=['', '', ', …'],
    steps=['인증 설정 읽기', '로그인 폼 추가', 'E2E 테스트 실행'],
    times=['10:10', '10:11', '10:12'],
    h_time='시각', h_step='단계', h_result='결과', ok='성공', blocked='중단',
    res_all=['성공', '중단', '결정 필요', '결정됨', '보류'],
    empty='아직 기록한 단계가 없습니다.',
    cause_l='원인', notdone_l='진행하지 못한 작업', items=['로그인 E2E 검증', '회원가입 E2E 검증'],
    attempt_l='시도 1',
    cause='로그인 화면이 30초 뒤 시간 초과', attempt='대기를 60초로 늘림',
    reason='이유: CI가 느린 것일 수 있음',
    sep=': ',
    back='[ ← 목록 ]', dur='10:11 ~ 10:12 (1분)',
    sum=lambda s, k, m, j: (f' 단계 {s}개, ', f'결정 필요 {k}개', ', ', f'중단 {m}개', ', ', f'보류 {j}개'),
    detail_l='상세', act_l='한 일',
    acts=['Bash pnpm test:e2e', 'Edit playwright.config.ts', 'Bash pnpm test:e2e'],
    detail='pnpm test:e2e를 두 번 실행했고, 두 번 모두 대기 시간이 끝난 뒤 로그인 화면에서 멈췄습니다.',
    qlabel='질문: ', qph='세션 컨텍스트에는 영향이 가지 않는 대화입니다',
    question='E2E 테스트는 왜 실패했어?', thinking='답을 만드는 중입니다…',
    answer='로그인 화면이 30초 뒤 시간 초과됐습니다. 대기를 60초로 늘려도 해결되지 않아 중단됐고, E2E 검증 2개를 진행하지 못했습니다.',
)


def fit(s, width):
    """Cut a placeholder with an ellipsis (width in px) so the input row fits the narrower pane."""
    if wpx(s) <= width:
        return s
    while wpx(s + '…') > width:
        s = s[:-1]
    return s.rstrip() + '…'


# ---- template -----------------------------------------------------------
def build(S):
    KF.clear()
    out = []
    add = out.append

    # timeline (seconds)
    t_type1, t_enter1 = (0.3, 1.1), 1.3
    t_pane = (1.7, 2.3)
    t_type2, t_enter2 = (3.1, 4.5), 4.8
    t_tool = [5.6, 7.0, 8.4]
    t_row = [5.8, 7.2, 8.6]
    t_click, t_list_off, t_det_on = 11.15, 11.4, 11.5
    t_focus = 14.45
    t_type3, t_enter3 = (15.5, 16.9), 17.6
    t_think, t_ans = 17.8, 19.0
    focus_wins = [(t_focus, None)]

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
    add(typed(chat_x(2), PROMPT_ROW + 1, '/flow', *t_type1, [(0.2, t_enter1)], BG))
    add(typed(chat_x(2), PROMPT_ROW + 1, S['task'], *t_type2, [(t_type2[0] - 0.1, t_enter2)], BG))

    # ---- chat column (dim except markers)
    def user_row(row, s):
        return (rect(X0, ry(row), wpx(s) + 3 * CELL, LH, QROW_BG)
                + runs(X0, ry(row), [('❯', GRAY, False), (' ' + s, GRAY, False)]))

    add(g(user_row(0, '/flow')
          + runs(X0, ry(1), [('  ⎿  ', GRAY, False), (S['opened'], GRAY, False)]), [(1.4, None)], hidden=False))
    add(g(user_row(3, S['task']), [(t_enter2 + 0.1, None)], hidden=False))
    row, spin_rows = 5, []
    for i, (title, status) in enumerate(S['tools']):
        spin_rows.append(row)
        args = f'(title: "{title}", status: "{status}"{S["tool_extra"][i]})'
        lines = wrap('step-flow - step (MCP)' + args, (WRAP_CHAT - 2) * CELL)
        assert len(lines) <= 2, lines
        body = runs(X0, ry(row), [('⏺', GREEN, False), (' ' + lines[0], GRAY, False)])
        for j, ln in enumerate(lines[1:], 1):
            body += runs(X0, ry(row + j), [('  ' + ln, GRAY, False)])
        body += runs(X0, ry(row + len(lines)), [('  ⎿  ', GRAY, False), ('recorded', GRAY, False)])
        add(g(body, [(t_tool[i], None)], hidden=False))
        row += len(lines) + 2
    spin_rows.append(row)
    assert row <= PR, 'chat overflows'
    # spinner follows the end of the transcript (steps, no easing)
    def tr(i):
        return f'transform:translateY({(spin_rows[i] - spin_rows[0]) * LH}px)'
    pts = [(0, tr(0))]
    for i, t in enumerate(t_tool):
        pts += [(t, tr(i)), (t + EPS, tr(i + 1))]
    pts += [(DUR - EPS, tr(3)), (DUR, tr(0))]
    spin = f'<g class="{kf(pts)}">' + runs(X0, ry(spin_rows[0]), [('✻', GRAY, False), (' ' + S['working'], GRAY, False)]) + '</g>'
    add(g(spin, [(t_enter2 + 0.2, 9.7)]))

    # ---- pane
    X = pane_x(0)
    SUMR, RULER, QR = PR - 4, PR - 3, PR - 2
    p = []
    p.append(rect(PX, TOP, PANE_COLS * CELL, PR * LH, PANE_BG))
    bx = PX + CELL / 2 - 0.75
    p.append(rect(bx, TOP, 1.5, PR * LH, DIMB))
    p.append(g(rect(bx, TOP, 1.5, PR * LH, FOCUS), focus_wins))
    p.append(text(pane_x(PCW - 2), ry(0) + 12.5, '✕', GRAY))

    # list view: pinned header + rule; done steps are one row, the blocked step lists its fields (indent 7)
    res_w = max(wpx(v) for v in S['res_all'])
    res_x = (PCW - 6) * CELL - res_w
    field_w = PCW * CELL - 7 * CELL - res_w - 2 * CELL     # fields must end before the result column
    lst = [text(X, ry(1) + 12.5, S['h_time'], GRAY), text(X + 7 * CELL, ry(1) + 12.5, S['h_step'], GRAY),
           text(X + res_x, ry(1) + 12.5, S['h_result'], GRAY), hline(X, ry(2) + LH / 2, PCW * CELL, RULE),
           g(text(X, ry(3) + 12.5, S['empty'], GRAY), [(t_pane[1], t_row[0] - 0.05)])]
    for i in range(3):
        bad = i == 2
        r = ry(3 + i)
        body = text(X, r + 12.5, S['times'][i], GRAY)
        body += text(X + 7 * CELL, r + 12.5, S['steps'][i], RED if bad else FG, bad)
        body += text(X + res_x, r + 12.5, S['blocked'] if bad else S['ok'], RED if bad else GREEN, True)
        if bad:
            sep = S['sep']
            nd = 5 + len(S['items'])                       # blank row after the Not done items
            for j, (lab, val) in ((2, (S['cause_l'], S['cause'])), (nd + 1, (S['attempt_l'], S['attempt']))):
                assert wpx(lab + sep + val) <= field_w + 0.01, (lab, val, wpx(lab + sep + val), field_w)
                body += runs(X + 7 * CELL, ry(3 + i + j), [(lab + sep, GRAY, False), (val, FG, False)])
            assert wpx(S['notdone_l'] + ':') <= field_w + 0.01
            body += text(X + 7 * CELL, ry(3 + i + 4) + 12.5, S['notdone_l'] + ':', GRAY)
            for j, it in enumerate(S['items']):
                assert wpx('- ' + it) <= field_w + 0.01, it
                body += text(X + 7 * CELL, ry(3 + i + 5 + j) + 12.5, '- ' + it, FG)
            assert wpx(S['reason']) <= field_w + 0.01, S['reason']
            body += runs(X + 7 * CELL, ry(3 + i + nd + 2), [(S['reason'], GRAY, False)])
        lst.append(g(body, [(t_row[i], None)], hidden=False))
    p.append(g(''.join(lst), [(t_pane[1], t_list_off)], hidden=False))

    # detail view of the blocked step: [ ← List ] pinned, the rest scrolls in a window under it
    vx = max(wpx(l) for l in (S['cause_l'], S['notdone_l'], S['attempt_l'], S['detail_l'])) + 2 * CELL
    badge = ' ' + S['blocked'] + ' '

    def L(i):
        return i * LH
    ni = len(S['items'])
    a0 = 6 + ni + 1                                    # Attempt row (after the Not done rows and a blank)
    body_w = PCW * CELL - vx                           # the body column narrows with the label column
    for t_ in [S['cause'], S['attempt'], S['reason']] + ['- ' + it for it in S['items']]:
        assert wpx(t_) <= body_w + 0.01, (t_, wpx(t_), body_w)
    c = [rect(0, L(1), wpx(badge), LH, RED), text(CELL, L(1) + 12.5, S['blocked'], PANE_BG, True),
         text(wpx(badge) + CELL, L(1) + 12.5, S['steps'][2], FG, True),
         text(0, L(2) + 12.5, S['dur'], GRAY), hline(0, L(3) + LH / 2, PCW * CELL, RULE),
         text(0, L(4) + 12.5, S['cause_l'], RED), text(vx, L(4) + 12.5, S['cause'], FG),
         text(0, L(6) + 12.5, S['notdone_l'], GRAY),
         text(0, L(a0) + 12.5, S['attempt_l'], GRAY), text(vx, L(a0) + 12.5, S['attempt'], FG),
         text(vx, L(a0 + 1) + 12.5, S['reason'], GRAY),
         hline(0, L(a0 + 2) + LH / 2, PCW * CELL, RULE), text(0, L(a0 + 3) + 12.5, S['act_l'], GRAY)]
    for j, it in enumerate(S['items']):
        c.append(text(vx, L(6 + j) + 12.5, '- ' + it, FG))
    for j, a_ in enumerate(S['acts']):
        c.append(text(0, L(a0 + 4 + j) + 12.5, a_, GRAY))
    r0 = a0 + 4 + len(S['acts'])
    c.append(hline(0, L(r0) + LH / 2, PCW * CELL, RULE))
    dl = wrap(S['detail'], PCW * CELL - vx)
    c.append(text(0, L(r0 + 1) + 12.5, S['detail_l'], GRAY))
    for j, ln in enumerate(dl):
        c.append(text(vx, L(r0 + 1 + j) + 12.5, ln, FG))
    q0 = r0 + 1 + len(dl)                     # lines used by the detail view
    assert q0 <= WIN, (q0, WIN)
    ans = wrap(S['answer'], (PCW - 2) * CELL)
    # Q&A appended under the detail: blank, question row (with its ✕), blank, answer. Once the content is taller than
    # the window it gets a ═ cap row at the very start and end; the window follows the end, so only the end cap shows.
    def cap(line):
        y = L(line) + LH / 2
        return hline(0, y - 1.5, PCW * CELL, RULE) + hline(0, y + 1.5, PCW * CELL, RULE)
    c_think, c_ans = q0 + 4, q0 + 3 + len(ans)             # content lines while thinking / answered
    qa = [g(rect(0, L(q0 + 1), 2 * CELL, LH, QROW_BG)
            + runs(0, L(q0 + 1), [('❯', GRAY, False), (' ', GRAY, False), (S['question'], FG, False)])
            + text((PCW - 2) * CELL, L(q0 + 1) + 12.5, '✕', GRAY), [(t_enter3 + 0.15, None)]),
          g(runs(0, L(q0 + 3), [('✻', GRAY, False), (' ' + S['thinking'], GRAY, False)]), [(t_think, t_ans)]),
          g(cap(c_think), [(t_enter3, t_ans, 0.05, 0.05)]),
          g(''.join(runs(0, L(q0 + 3 + j), [(('⏺ ' if j == 0 else '  ') + ln, FG, False)])
                    for j, ln in enumerate(ans)) + cap(c_ans), [(t_ans, None)])]
    assert c_think > WIN, 'the content must overflow once the question is asked'
    s1, s2 = c_think + 2 - WIN, c_ans + 2 - WIN            # hidden lines above (start cap counts) thinking / answered
    assert 0 < s1 < s2
    # content coordinates exclude the start cap, so while capped the content sits one line lower: shift (1 - s)
    tr = lambda k: f'transform:translateY({(1 - k) * LH}px)'
    scroll = kf([(0, 'transform:translateY(0)'), (t_enter3, 'transform:translateY(0)'), (t_enter3 + 0.12, tr(s1)),
                 (t_ans, tr(s1)), (t_ans + 0.12, tr(s2)), (DUR - EPS, tr(s2)), (DUR, 'transform:translateY(0)')])
    det = [text(X, ry(1) + 12.5, S['back'], FG, True),
           f'<svg x="{n(X)}" y="{ry(2)}" width="{n(PCW * CELL)}" height="{WIN * LH}" overflow="hidden">'
           f'<g class="{scroll}">{"".join(c)}{"".join(qa)}</g></svg>']
    for v, wins in ((s1, [(t_enter3, t_ans, 0.05, 0.05)]), (s2, [(t_ans, None, 0.05)])):
        m_ = f'↑ {v}'
        det.append(g(text(X + PCW * CELL - wpx(m_), ry(2) + 12.5, m_, GRAY), wins))
    p.append(g(''.join(det), [(t_det_on, None)]))                 # not in the poster

    # footer, pinned: summary, rule, question input (unfocused / focused / typing)
    sums = [(0, 0, t_pane[1], t_row[0]), (1, 0, t_row[0], t_row[1]), (2, 0, t_row[1], t_row[2]),
            (3, 1, t_row[2], None)]
    for k, (st, bl, a, b) in enumerate(sums):
        parts = S['sum'](st, 0, bl, 0)
        cols = [FG, GREEN, FG, RED if bl else GREEN, FG, GREEN]
        inner = (rect(X, ry(SUMR), wpx(''.join(parts)), LH, SUM_BG)
                 + runs(X, ry(SUMR), [(t_, c_, False) for t_, c_ in zip(parts, cols)]))
        p.append(g(inner, [(a, b)], hidden=(k != 3)))
    p.append(hline(X, ry(RULER) + LH / 2, PCW * CELL, RULE))
    qw = PCW * CELL - wpx(S['qlabel']) - 3 * CELL
    ph = fit(S['qph'], qw)
    unf = runs(X, ry(QR), [(S['qlabel'], FG, False), (ph, GRAY, False)])
    foc = (runs(X, ry(QR), [(S['qlabel'], FG, True)])
           + runs(X + wpx(S['qlabel']), ry(QR), [(ph, '#6c6c6c', False), (' ⏎ ', GRAY, False)]))
    p.append(g(unf, [(0, t_focus), (RESET, DUR)], hidden=False))
    p.append(g(foc, [(t_focus, t_type3[0] - 0.1), (t_enter3, None)]))
    qx = X + wpx(S['qlabel'])
    p.append(typed(qx, QR, S['question'], *t_type3, [(t_type3[0] - 0.1, t_enter3)], PANE_BG,
                   extra_after=(runs(X, ry(QR), [(S['qlabel'], FG, True)])
                                + text(qx + wpx(S['question']) + CELL, ry(QR) + 12.5, '⏎', GRAY))))

    pane_cls = kf([(0, 'opacity:0;transform:translateX(120px)'), (t_pane[0], 'opacity:0;transform:translateX(120px)'),
                   (t_pane[1], 'opacity:1;transform:translateX(0)'), (RESET, 'opacity:1;transform:translateX(0)'),
                   (DUR, 'opacity:0;transform:translateX(0)')])
    add(f'<g class="{pane_cls}">{"".join(p)}</g>')

    # ---- cursor (outer: show/hide, middle: position, inner: press)
    glide = [(9.9, 'transform:translate(820px,360px)'),
             (11.0, f'transform:translate({n(pane_x(10))}px,{n(ry(5) + 9)}px)'),
             (12.8, f'transform:translate({n(pane_x(10))}px,{n(ry(5) + 9)}px)'),
             (14.2, f'transform:translate({n(pane_x(15))}px,{n(ry(QR) + 9)}px)'),
             (15.3, f'transform:translate({n(pane_x(15))}px,{n(ry(QR) + 9)}px)')]
    pos = kf([(0, glide[0][1])] + glide + [(DUR, glide[0][1])])
    press = kf([(0, 'transform:scale(1)'), (t_click, 'transform:scale(1)'), (t_click + 0.1, 'transform:scale(.88)'),
                (t_click + 0.25, 'transform:scale(1)'), (14.3, 'transform:scale(1)'),
                (14.4, 'transform:scale(.88)'), (14.55, 'transform:scale(1)'), (DUR, 'transform:scale(1)')])
    arrow = ('<path d="M0 0V15l3.9-3.6 2.7 6.3 2.4-1-2.6-6.2h5.2Z" fill="#ffffff" stroke="#000000" '
             'stroke-width="1" stroke-linejoin="round"/>')
    add(g(f'<g class="{pos}"><g class="{press} pr">{arrow}</g></g>', [(9.9, 15.1)]))

    # ---- captions
    for i, cap in enumerate(S['caps']):
        cy = TERM_H + (H - TERM_H) / 2
        body = (f'<circle cx="{X0 + 11}" cy="{n(cy)}" r="11" fill="#2b2b2b"/>'
                f'<text class="cap" x="{X0 + 11}" y="{n(cy + 4.5)}" text-anchor="middle" fill="{FOCUS}" '
                f'font-weight="700">{i + 1}</text>'
                f'<text class="cap" x="{X0 + 34}" y="{n(cy + 5)}" fill="{FG}">{escape(cap, quote=False)}</text>')
        wins = {0: [(0, 4.9), (RESET, DUR)], 1: [(5.0, 10.0)], 2: [(10.0, 14.0)], 3: [(14.0, RESET - 0.2, 0.15, 0.2)]}[i]
        add(g(body, wins, hidden=(i != 1)))        # poster shows caption 2

    css = ('svg{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,\'Liberation Mono\',monospace}'
           'text{font-size:14px;white-space:pre}.cap{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif}.h{opacity:0}.pr{transform-box:fill-box;transform-origin:center}'
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
        (here / f'guide-basic-{S["lang"]}.svg').write_text(build(S), encoding='utf-8')
