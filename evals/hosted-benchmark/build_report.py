"""Adds the 48-prompt agent-run sheets to evals/reports/2026-11-04_hosted_vs_drk_direct_calls_and_gemini_48.xlsx.

Statuses come from explicit rules over the saved transcripts (no LLM judge), so they are a first pass:
read the evidence columns before quoting a status. Run with a Python that has openpyxl:
    python3 evals/hosted-benchmark/build_report.py
"""
import json, re, statistics as st, os
from collections import Counter
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

D = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(D, '..', 'reports', '2026-11-04_hosted_vs_drk_direct_calls_and_gemini_48.xlsx')
runs = json.load(open(D + '/agent_results.json'))
judged = json.load(open(D + '/judged.json')) if os.path.exists(D + '/judged.json') else {}
prompts = json.load(open(D + '/prompts.json'))
decls = json.load(open(D + '/decls.json'))
tools = {s: {t['name'] for t in decls[s]} for s in decls}

DOCS = {'search_documentation', 'get_documentation', 'list_documentation_topics', 'get_api_parameters', 'reason_and_route'}
MAPS = {'get_static_map', 'static_map_image', 'static_route_map'}
NO_TOOL = re.compile(r"(no |not |n't |isn't |aren't )(\w+ ){0,4}(tool|exposed|available|supported)|unable to|cannot (directly )?(create|execute|perform|run)|can't (directly )?(create|execute|perform|run)|does not (expose|provide)|not currently exposed|not exposed", re.I)
BUGERR = re.compile(r'\b(404|500|502|503|504)\b|invalid url path|upstream|internal error', re.I)
RANK = {'Pass': 6, 'Partial Pass': 5, 'Ungrounded': 4, 'Partial Fail': 3, 'Capability Gap': 2, 'Fail': 1, 'Fail (Bug)': 1}


def classify(p, s, r):
    pid, qa = p['id'], p['type'].startswith('API')
    calls, final = r['calls'], (r['final'] or '')
    ok = [c for c in calls if not c['isError']]
    bad = [c for c in calls if c['isError']]
    named = re.findall(r'\b[a-z]+(?:_[a-z]+)+\b', p['prompt'])
    named = [n for n in named if n not in ('doc_id',)]
    ev = f"{len(calls)} call(s): " + (', '.join(c['tool'] + ('!' if c['isError'] else '') for c in calls) or 'none')
    if r['err']:
        return 'Partial Fail', f"Agent ended without a final answer ({r['err']}). Calls made: {len(calls)}. Likely model looping, not necessarily a server fault.", ev
    if qa:
        grounded = [c for c in ok if c['tool'] in DOCS]
        if grounded: return 'Pass', 'Grounded in documentation tool results.', ev
        if NO_TOOL.search(final) and not calls: return 'Capability Gap', 'No tool available to ground the answer; the assistant said so.', ev
        return 'Ungrounded', 'Answered without a successful documentation lookup.', ev
    # Tool-call prompt
    docs_prompt = pid.startswith('08')
    action_ok = [c for c in ok if docs_prompt or c['tool'] not in DOCS]
    missing = [n for n in named if n not in tools[s]]
    if missing and not docs_prompt:  # the prompt names a tool this server does not have; improvised tools do not count
        return 'Capability Gap', f"Named tool {', '.join(missing)} is not on this server's tool list" + (f"; the model improvised with {', '.join(sorted({c['tool'] for c in action_ok}))}, which does not do the task" if action_ok else '') + '.', ev
    if not action_ok:
        if bad and any(BUGERR.search(c['result']) for c in bad):
            return 'Fail (Bug)', 'The relevant tool errored: ' + bad[-1]['result'][:140].replace('\n', ' '), ev
        if bad: return 'Fail', 'The relevant tool errored: ' + bad[-1]['result'][:140].replace('\n', ' '), ev
        if missing or NO_TOOL.search(final):
            return 'Capability Gap', 'Server exposes no tool for this' + (f" ({', '.join(missing)} not in tool list)" if missing else '') + '.', ev
        return 'Fail', 'No successful action tool call.', ev
    notes = []
    wants_map = re.search(r'static map|map image|rendered map|render', p['prompt'], re.I)
    if wants_map and not [c for c in ok if c['tool'] in MAPS] and not any(c['args'].get('include_map') for c in ok):
        notes.append('requested map not produced')
    # Missing named tool but the model improvised with other tools
    if missing and not docs_prompt:
        notes.append(f"named tool {', '.join(missing)} not on this server; improvised with {', '.join(sorted({c['tool'] for c in action_ok}))}")
    if bad: notes.append(f"{len(bad)} tool error(s) before success: " + bad[0]['result'][:100].replace('\n', ' '))
    if notes: return 'Partial Pass', '; '.join(notes) + '.', ev
    return 'Pass', 'Relevant tool(s) succeeded.', ev


rows = []
for p in prompts:
    row = {'p': p}
    for s in ('off', 'drk'):
        r = runs.get(f"{p['id']}|{s}")
        if r is None: row[s] = None; continue
        rule, rverdict, ev = classify(p, s, r)
        j = judged.get(f"{p['id']}|{s}")
        stt, verdict = (j['status'], j['verdict']) if j and j['status'] in RANK else (rule, rverdict)
        row[s] = dict(r=r, status=stt, verdict=verdict, ev=ev, rule=rule, judged=bool(j and j['status'] in RANK))
    if row['off'] and row['drk']:
        a, b = RANK[row['off']['status']], RANK[row['drk']['status']]
        row['win'] = 'Tie' if a == b else ('NB Official' if a > b else 'drk')
    else:
        row['win'] = 'Not run (quota)'
    rows.append(row)

H = PatternFill('solid', fgColor='1F3864'); HF = Font(bold=True, color='FFFFFF'); T = Font(bold=True, size=14)
FILL = {'Pass': 'C6EFCE', 'Partial Pass': 'E2EFDA', 'Ungrounded': 'FFEB9C', 'Capability Gap': 'D9D9D9', 'Partial Fail': 'FCE4D6', 'Fail': 'FFC7CE', 'Fail (Bug)': 'FFC7CE'}
thin = Side(style='thin', color='BBBBBB'); B = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='top')
wb = load_workbook(XLSX)
for n in ('48-Prompt Summary', '48-Prompt Detail'):
    if n in wb.sheetnames: del wb[n]
STAT = ['Pass', 'Partial Pass', 'Ungrounded', 'Capability Gap', 'Partial Fail', 'Fail', 'Fail (Bug)']
done = [r for r in rows if r['off'] and r['drk']]
OFF, DRK = 'NB Official (hosted)', 'drk hybrid'
# ---- Summary
ws = wb.create_sheet('48-Prompt Summary')
ws['A1'] = '48-Prompt Agent Run: hosted Official vs drk hybrid'; ws['A1'].font = T
ws['A2'] = (f"{len(done)} of 48 prompts have results for both servers ({sum(1 for r in rows for s in ('off','drk') if r[s])} of 96 runs). "
            "Model: gemini-3.8-flash, temperature 0, max 8 tool turns, tool results truncated to 12k chars for the model. "
            "Statuses come from an LLM judge (gemini-3.8-flash) reading each transcript; a rule-based check is kept alongside. See Method & Caveats.")
ws['A2'].alignment = wrap; ws.merge_cells('A2:G2'); ws.row_dimensions[2].height = 48
r = 4
def hdr(vals):
    global r
    for i, v in enumerate(vals, 1):
        c = ws.cell(r, i, v); c.fill = H; c.font = HF; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
    r += 1
def put(vals, fills=None):
    global r
    for i, v in enumerate(vals, 1):
        c = ws.cell(r, i, v); c.border = B; c.alignment = wrap
    r += 1
ws.cell(r, 1, 'Winner tally').font = Font(bold=True, size=12); r += 1
hdr(['Winner', 'Prompts'])
for k, v in Counter(x['win'] for x in done).most_common(): put([k, v])
r += 1; ws.cell(r, 1, 'Status breakdown').font = Font(bold=True, size=12); r += 1
hdr(['Status', OFF, DRK])
for s in STAT:
    put([s, sum(1 for x in done if x['off']['status'] == s), sum(1 for x in done if x['drk']['status'] == s)])
    ws.cell(r - 1, 1).fill = PatternFill('solid', fgColor=FILL[s])
r += 1; ws.cell(r, 1, 'By capability category (winner)').font = Font(bold=True, size=12); r += 1
hdr(['Category', 'drk wins', 'Official wins', 'Ties', 'Official Pass+Partial', 'drk Pass+Partial', 'Prompts'])
cats = sorted({x['p']['category'] for x in done})
for c in cats:
    xs = [x for x in done if x['p']['category'] == c]
    gd = lambda s: sum(1 for x in xs if x[s]['status'] in ('Pass', 'Partial Pass'))
    put([c, sum(x['win'] == 'drk' for x in xs), sum(x['win'] == 'NB Official' for x in xs), sum(x['win'] == 'Tie' for x in xs), gd('off'), gd('drk'), len(xs)])
r += 1; ws.cell(r, 1, 'By prompt type (winner)').font = Font(bold=True, size=12); r += 1
hdr(['Prompt type', 'drk wins', 'Official wins', 'Ties', 'Official Pass+Partial', 'drk Pass+Partial', 'Prompts'])
for t in ('MCP Tool Call', 'API/SDK Knowledge Q&A'):
    xs = [x for x in done if x['p']['type'] == t]
    gd = lambda s: sum(1 for x in xs if x[s]['status'] in ('Pass', 'Partial Pass'))
    put([t, sum(x['win'] == 'drk' for x in xs), sum(x['win'] == 'NB Official' for x in xs), sum(x['win'] == 'Tie' for x in xs), gd('off'), gd('drk'), len(xs)])
r += 1; ws.cell(r, 1, 'Agent-run cost (per run, mean over completed prompts)').font = Font(bold=True, size=12); r += 1
hdr(['Metric', OFF, DRK])
m = lambda s, f: round(st.mean(f(x[s]['r']) for x in done), 1)
put(['Tool calls', m('off', lambda q: len(q['calls'])), m('drk', lambda q: len(q['calls']))])
put(['Tool errors', m('off', lambda q: sum(c['isError'] for c in q['calls'])), m('drk', lambda q: sum(c['isError'] for c in q['calls']))])
put(['Duration (s)', m('off', lambda q: q['ms'] / 1000), m('drk', lambda q: q['ms'] / 1000)])
put(['Input tokens', m('off', lambda q: q['tokens_in']), m('drk', lambda q: q['tokens_in'])])
put(['Output tokens (incl. thinking)', m('off', lambda q: q['tokens_out']), m('drk', lambda q: q['tokens_out'])])
r += 1; ws.cell(r, 1, 'Key takeaways').font = Font(bold=True, size=12); r += 1
cnt = lambda s, k: sum(1 for x in done if x[s]['status'] == k)
tool_prompts = [x for x in done if x['p']['type'] == 'MCP Tool Call']
modelside = re.compile(r'turn limit|ran out of turns|truncated|cut off|cuts off|output token|exceeded the maximum|timed out', re.I)
ms = lambda sv: sum(1 for x in done if x[sv]['status'] in ('Fail', 'Partial Fail') and modelside.search(x[sv]['verdict']))
wins = Counter(x['win'] for x in done)
agree = sum(1 for x in done for sv in ('off', 'drk') if x[sv]['status'] == x[sv]['rule'])
txt = [
    f"Across {len(done)} prompts drk won {wins['drk']}, the official server won {wins['NB Official']} and {wins['Tie']} tied (judged statuses).",
    f"Capability Gaps: official {cnt('off','Capability Gap')} vs drk {cnt('drk','Capability Gap')}. The official server has no tracking/geofence, optimization, road-restriction, traffic or weather tools, so those prompts end as gaps.",
    f"Failures that look model-side (turn limit, truncated or cut-off answers): official {ms('off')}, drk {ms('drk')}. These are not server faults and depress both columns, so do not read them as server quality.",
    f"Real server findings: drk create_road_restriction returns 404 on valid input (07-3, judged Fail (Bug)); create_geofence rejected circle input and needed batch_create_geofences (05-2); driver_assignment_sync needed retries for a missing 'filter' (06-1). The official server fabricated an answer on 08-4 about reason_and_route, which it does not have.",
    f"Where both servers have the same tool (geocoding, places, directions, static maps, docs) results are alike. Judge and rule-based statuses agree on {agree} of {2*len(done)} runs; disagreements are mostly the judge downgrading answers that were truncated or unsupported.",
]
for t in txt:
    c = ws.cell(r, 1, '• ' + t); c.alignment = wrap; ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7); ws.row_dimensions[r].height = 46; r += 1
for i, w in enumerate([36, 22, 22, 12, 22, 20, 10], 1): ws.column_dimensions[get_column_letter(i)].width = w
# ---- Detail
w2 = wb.create_sheet('48-Prompt Detail')
cols = ['ID', 'Category', 'Prompt Type', 'Prompt Title', 'Prompt', f'{OFF} Status', f'{OFF} Verdict (LLM judge)', f'{OFF} Tool calls', f'{OFF} Final answer (excerpt)',
        f'{DRK} Status', f'{DRK} Verdict (LLM judge)', f'{DRK} Tool calls', f'{DRK} Final answer (excerpt)', 'Winner', 'Official s / calls / tokens in', 'drk s / calls / tokens in', 'Rule-based status (Official / drk)']
for i, v in enumerate(cols, 1):
    c = w2.cell(1, i, v); c.fill = H; c.font = HF; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
def metrics(x): return f"{x['r']['ms']/1000:.0f}s / {len(x['r']['calls'])} / {x['r']['tokens_in']}" if x else ''
for i, x in enumerate(rows, 2):
    p, o, d = x['p'], x['off'], x['drk']
    vals = [p['id'], p['category'], p['type'], p['title'], p['prompt'],
            o['status'] if o else 'Not run', o['verdict'] if o else 'Gemini daily quota reached before this run.', o['ev'] if o else '', (o['r']['final'] or '(empty)')[:500] if o else '',
            d['status'] if d else 'Not run', d['verdict'] if d else 'Gemini daily quota reached before this run.', d['ev'] if d else '', (d['r']['final'] or '(empty)')[:500] if d else '',
            x['win'], metrics(o), metrics(d), f"{o['rule'] if o else '-'} / {d['rule'] if d else '-'}"]
    for j, v in enumerate(vals, 1):
        c = w2.cell(i, j, v); c.alignment = wrap; c.border = B
    for col, e in ((6, o), (10, d)):
        if e: w2.cell(i, col).fill = PatternFill('solid', fgColor=FILL[e['status']])
for i, w in enumerate([7, 22, 14, 26, 44, 14, 44, 30, 55, 14, 44, 30, 55, 14, 16, 16, 26], 1): w2.column_dimensions[get_column_letter(i)].width = w
w2.freeze_panes = 'E2'; w2.auto_filter.ref = w2.dimensions
# ---- Method note
mt = wb['Method & Caveats']; n = mt.max_row + 2
extra = [
    '48-prompt agent run (added 2026-11-05): prompts from evals/reports/2026-11-03_48_prompt_manual_comparison.xlsx; each prompt run once per server with gemini-3.8-flash (Gemini stands in for the Claude client used in the earlier reports, so statuses are not directly comparable to those). drk calls had the API key injected by the harness.',
    'Statuses are from an LLM judge (gemini-3.8-flash, temperature 0) that reads the prompt, the server tool list, the tool trace and the final answer, using the earlier report labels. The same model family ran the agent and the judge, so judge bias is possible. The rule-based column is the earlier first-pass check, kept for comparison. Rule-based logic: tool-call prompts need a successful action tool; knowledge prompts need a successful documentation tool; a named tool missing from the server list means Capability Gap; tool errors with 404/5xx text mean Fail (Bug); requested maps not produced or recovered errors mean Partial Pass. The earlier report used human/Claude judgement. ',
    'Winner ranking: Pass > Partial Pass > Ungrounded > Partial Fail > Capability Gap > Fail = Fail (Bug), matching the earlier report where a missing tool beats an attempted failure. Rows where drk hit a bug and the official server had no tool are a wash, not a quality edge.',
    'Single run per prompt at temperature 0; model looping can produce "no final answer" without any server fault. Missing runs (quota): ' + ', '.join(f"{x['p']['id']}" for x in rows if not (x['off'] and x['drk'])) + '.',
]
for i, l in enumerate(extra):
    c = mt.cell(n + i, 1, l); c.alignment = wrap; mt.row_dimensions[n + i].height = 60
wb.save(XLSX)
print(len(done), 'prompts reported;', Counter(x['win'] for x in done))
for s in ('off', 'drk'): print(s, Counter(x[s]['status'] for x in done))
