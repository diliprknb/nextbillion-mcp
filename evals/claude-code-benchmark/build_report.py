"""Builds evals/reports/2026-11-06_claude_code_48_prompt_run.xlsx from the saved Claude Code runs.

Needs a Python with openpyxl (e.g. `python3 -m venv ~/.cache/venv48 && ~/.cache/venv48/bin/pip install openpyxl`):
    ~/.cache/venv48/bin/python evals/claude-code-benchmark/build_report.py
Statuses come from results/judged.json (Claude Code judge); a rule-based check over the traces is kept as a cross-check.
"""
import json, re, os, statistics as st
from collections import Counter
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

D = os.path.dirname(os.path.abspath(__file__))
OUTFILE = os.path.join(D, '..', 'reports', '2026-11-06_claude_code_48_prompt_run.xlsx')
runs = json.load(open(D + '/results/agent_results.json'))
judged = json.load(open(D + '/results/judged.json')) if os.path.exists(D + '/results/judged.json') else {}
tools = json.load(open(D + '/results/tools.json'))
prompts = json.load(open(D + '/prompts.json'))

DOCS = {'search_documentation', 'get_documentation', 'list_documentation_topics', 'get_api_parameters', 'reason_and_route'}
MAPS = {'get_static_map', 'static_map_image', 'static_route_map'}
NO_TOOL = re.compile(r"(no |not |n't |isn't |aren't )(\w+ ){0,4}(tool|exposed|available|supported)|unable to|cannot (directly )?(create|execute|perform|run)|can't (directly )?(create|execute|perform|run)|does not (expose|provide)|not currently exposed|not exposed", re.I)
BUGERR = re.compile(r'\b(404|500|502|503|504)\b|invalid url path|upstream|internal error', re.I)
RANK = {'Pass': 6, 'Partial Pass': 5, 'Ungrounded': 4, 'Partial Fail': 3, 'Capability Gap': 2, 'Fail': 1, 'Fail (Bug)': 1}
STAT = list(RANK)
OFF, DRK = 'NB Official (hosted)', 'drk hybrid'


def classify(p, s, r):
    """Rule-based first pass over the trace (ToolSearch is Claude Code's own tool discovery and is ignored)."""
    calls = [c for c in r['calls'] if c['tool'] != 'ToolSearch']
    final = r['final'] or ''
    ok = [c for c in calls if not c['isError']]
    bad = [c for c in calls if c['isError']]
    qa = p['type'].startswith('API')
    ev = f"{len(calls)} call(s): " + (', '.join(c['tool'] + ('!' if c['isError'] else '') for c in calls) or 'none')
    if r['err']:
        return 'Partial Fail', f"Run ended abnormally ({r['err']}).", ev
    if qa:
        if [c for c in ok if c['tool'] in DOCS]: return 'Pass', 'Grounded in documentation tool results.', ev
        if NO_TOOL.search(final) and not calls: return 'Capability Gap', 'No tool available to ground the answer; the assistant said so.', ev
        return 'Ungrounded', 'Answered without a successful documentation lookup.', ev
    named = [n for n in re.findall(r'\b[a-z]+(?:_[a-z]+)+\b', p['prompt']) if n != 'doc_id']
    docs_prompt = p['id'].startswith('08')
    action_ok = [c for c in ok if docs_prompt or c['tool'] not in DOCS]
    missing = [n for n in named if n not in tools[s]]
    if missing and not docs_prompt:
        return 'Capability Gap', f"Named tool {', '.join(missing)} is not on this server's tool list.", ev
    if not action_ok:
        if bad and any(BUGERR.search(c['result']) for c in bad): return 'Fail (Bug)', 'Relevant tool errored: ' + bad[-1]['result'][:140].replace('\n', ' '), ev
        if bad: return 'Fail', 'Relevant tool errored: ' + bad[-1]['result'][:140].replace('\n', ' '), ev
        if NO_TOOL.search(final): return 'Capability Gap', 'Server exposes no tool for this.', ev
        return 'Fail', 'No successful action tool call.', ev
    notes = []
    if re.search(r'static map|map image|rendered map|render', p['prompt'], re.I) and not [c for c in ok if c['tool'] in MAPS] and not any((c['args'] or {}).get('include_map') for c in ok):
        notes.append('requested map not produced')
    if bad: notes.append(f"{len(bad)} tool error(s) along the way: " + bad[0]['result'][:100].replace('\n', ' '))
    return ('Partial Pass', '; '.join(notes) + '.', ev) if notes else ('Pass', 'Relevant tool(s) succeeded.', ev)


rows = []
for p in prompts:
    row = {'p': p}
    for s in ('off', 'drk'):
        r = runs.get(f"{p['id']}|{s}")
        if r is None: row[s] = None; continue
        rule, rv, ev = classify(p, s, r)
        j = judged.get(f"{p['id']}|{s}")
        use = bool(j and j['status'] in RANK)
        row[s] = dict(r=r, status=j['status'] if use else rule, verdict=j['verdict'] if use else rv, ev=ev, rule=rule, judged=use)
    if row['off'] and row['drk']:
        a, b = RANK[row['off']['status']], RANK[row['drk']['status']]
        row['win'] = 'Tie' if a == b else ('NB Official' if a > b else 'drk')
    else:
        row['win'] = 'Not run'
    rows.append(row)
done = [x for x in rows if x['off'] and x['drk']]
models = sorted({x[s]['r']['model'] for x in done for s in ('off', 'drk') if x[s]['r']['model']})

H = PatternFill('solid', fgColor='1F3864'); HF = Font(bold=True, color='FFFFFF'); T = Font(bold=True, size=14)
FILL = {'Pass': 'C6EFCE', 'Partial Pass': 'E2EFDA', 'Ungrounded': 'FFEB9C', 'Capability Gap': 'D9D9D9', 'Partial Fail': 'FCE4D6', 'Fail': 'FFC7CE', 'Fail (Bug)': 'FFC7CE'}
thin = Side(style='thin', color='BBBBBB'); B = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='top')
wb = Workbook()
ws = wb.active; ws.title = 'Summary'
ws['A1'] = '48-Prompt Run with Claude Code: hosted Official vs drk hybrid'; ws['A1'].font = T
ws['A2'] = (f"{len(done)} of 48 prompts have results for both servers. Agent: headless Claude Code (claude -p), model {', '.join(models)}, "
            f"max turns 8, one run per prompt per server. Statuses: Claude Code judge reading each transcript; rule-based check kept alongside. See Method & Caveats.")
ws['A2'].alignment = wrap; ws.merge_cells('A2:G2'); ws.row_dimensions[2].height = 48
r = 4
def hdr(vals):
    global r
    for i, v in enumerate(vals, 1):
        c = ws.cell(r, i, v); c.fill = H; c.font = HF; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
    r += 1
def put(vals):
    global r
    for i, v in enumerate(vals, 1):
        c = ws.cell(r, i, v); c.border = B; c.alignment = wrap
    r += 1
def title(t):
    global r
    ws.cell(r, 1, t).font = Font(bold=True, size=12); r += 1
title('Winner tally'); hdr(['Winner', 'Prompts'])
for k, v in Counter(x['win'] for x in done).most_common(): put([k, v])
r += 1; title('Status breakdown'); hdr(['Status', OFF, DRK])
for s in STAT:
    put([s, sum(x['off']['status'] == s for x in done), sum(x['drk']['status'] == s for x in done)]); ws.cell(r - 1, 1).fill = PatternFill('solid', fgColor=FILL[s])
def group(label, keyf, keys):
    global r
    r += 1; title(label); hdr([label.split(' (')[0], 'drk wins', 'Official wins', 'Ties', 'Official Pass+Partial', 'drk Pass+Partial', 'Prompts'])
    for k in keys:
        xs = [x for x in done if keyf(x) == k]
        gd = lambda sv: sum(x[sv]['status'] in ('Pass', 'Partial Pass') for x in xs)
        put([k, sum(x['win'] == 'drk' for x in xs), sum(x['win'] == 'NB Official' for x in xs), sum(x['win'] == 'Tie' for x in xs), gd('off'), gd('drk'), len(xs)])
group('By capability category (winner)', lambda x: x['p']['category'], sorted({x['p']['category'] for x in done}))
group('By prompt type (winner)', lambda x: x['p']['type'], ['MCP Tool Call', 'API/SDK Knowledge Q&A'])
r += 1; title('Agent-run cost (mean per run, completed prompts)'); hdr(['Metric', OFF, DRK])
m = lambda s, f: round(st.mean(f(x[s]['r']) for x in done), 2)
real = lambda q: [c for c in q['calls'] if c['tool'] != 'ToolSearch']
put(['Tool calls (excl. ToolSearch)', m('off', lambda q: len(real(q))), m('drk', lambda q: len(real(q)))])
put(['Tool errors', m('off', lambda q: sum(c['isError'] for c in real(q))), m('drk', lambda q: sum(c['isError'] for c in real(q)))])
put(['Wall time (s)', m('off', lambda q: q['ms'] / 1000), m('drk', lambda q: q['ms'] / 1000)])
put(['Input tokens (incl. cache)', m('off', lambda q: q['tokens_in']), m('drk', lambda q: q['tokens_in'])])
put(['Output tokens', m('off', lambda q: q['tokens_out']), m('drk', lambda q: q['tokens_out'])])
put(['Cost per run (USD, Claude Code estimate)', m('off', lambda q: q['cost_usd'] or 0), m('drk', lambda q: q['cost_usd'] or 0)])
put(['Cost, whole run (USD)', round(sum(x['off']['r']['cost_usd'] or 0 for x in done), 2), round(sum(x['drk']['r']['cost_usd'] or 0 for x in done), 2)])
cnt = lambda s, k: sum(x[s]['status'] == k for x in done)
wins = Counter(x['win'] for x in done)
agree = sum(x[sv]['status'] == x[sv]['rule'] for x in done for sv in ('off', 'drk'))
modelside = re.compile(r'turn limit|ran out of turns|max.turns|truncated|cut off|cuts off|output token|timed out|budget', re.I)
ms = lambda sv: sum(x[sv]['status'] in ('Fail', 'Partial Fail') and bool(modelside.search(x[sv]['verdict'] + (x[sv]['r']['err'] or ''))) for x in done)
r += 1; title('Key takeaways')
for t in [
    f"Across {len(done)} prompts drk won {wins['drk']}, the official server won {wins['NB Official']} and {wins['Tie']} tied.",
    f"Capability Gaps: official {cnt('off','Capability Gap')} vs drk {cnt('drk','Capability Gap')}. The official server has no tracking/geofence, optimization, road-restriction, traffic or weather tools.",
    f"Failures that look agent-side (turn/budget limit, truncated answer): official {ms('off')}, drk {ms('drk')}. These are not server faults.",
    f"Judge and rule-based statuses agree on {agree} of {2*len(done)} runs.",
    "Read the Detail sheet for the evidence behind every status, especially any Fail (Bug) rows.",
]:
    c = ws.cell(r, 1, '• ' + t); c.alignment = wrap; ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7); ws.row_dimensions[r].height = 34; r += 1
for i, w in enumerate([40, 22, 22, 12, 22, 20, 10], 1): ws.column_dimensions[get_column_letter(i)].width = w

w2 = wb.create_sheet('Detail')
cols = ['ID', 'Category', 'Prompt Type', 'Prompt Title', 'Prompt', f'{OFF} Status', f'{OFF} Verdict (judge)', f'{OFF} Tool calls', f'{OFF} Final answer (excerpt)',
        f'{DRK} Status', f'{DRK} Verdict (judge)', f'{DRK} Tool calls', f'{DRK} Final answer (excerpt)', 'Winner',
        'Official s / calls / tokens in / $', 'drk s / calls / tokens in / $', 'Rule-based status (Official / drk)']
for i, v in enumerate(cols, 1):
    c = w2.cell(1, i, v); c.fill = H; c.font = HF; c.border = B; c.alignment = Alignment(wrap_text=True, vertical='center')
mt = lambda e: f"{e['r']['ms']/1000:.0f}s / {len(real(e['r']))} / {e['r']['tokens_in']} / ${e['r']['cost_usd'] or 0:.3f}" if e else ''
for i, x in enumerate(rows, 2):
    p, o, d = x['p'], x['off'], x['drk']
    vals = [p['id'], p['category'], p['type'], p['title'], p['prompt'],
            o['status'] if o else 'Not run', o['verdict'] if o else '', o['ev'] if o else '', (o['r']['final'] or '(empty)')[:500] if o else '',
            d['status'] if d else 'Not run', d['verdict'] if d else '', d['ev'] if d else '', (d['r']['final'] or '(empty)')[:500] if d else '',
            x['win'], mt(o), mt(d), f"{o['rule'] if o else '-'} / {d['rule'] if d else '-'}"]
    for j, v in enumerate(vals, 1):
        c = w2.cell(i, j, v); c.alignment = wrap; c.border = B
    for col, e in ((6, o), (10, d)):
        if e: w2.cell(i, col).fill = PatternFill('solid', fgColor=FILL[e['status']])
for i, w in enumerate([7, 22, 14, 26, 44, 14, 44, 30, 55, 14, 44, 30, 55, 14, 22, 22, 26], 1): w2.column_dimensions[get_column_letter(i)].width = w
w2.freeze_panes = 'E2'; w2.auto_filter.ref = w2.dimensions

w3 = wb.create_sheet('Method & Caveats')
for i, l in enumerate([
    'Agent: headless Claude Code (`claude -p`), one run per prompt per server, in an empty working directory with built-in tools disabled and only the NextBillion MCP server connected (same server name for both, so tool-name prefixes are identical). Model = Claude Code default (' + ', '.join(models) + '). Max 8 turns, per-run budget cap.',
    'Auth: official server with Authorization: Bearer <key>; drk server with the x-api-key header. The model never sees the key.',
    'Claude Code defers MCP tool schemas behind its own ToolSearch tool, so most runs include a ToolSearch call before the first server call. ToolSearch is ignored in tool-call counts and in judging.',
    'Judge: a second headless Claude Code call (no tools, JSON schema) sees the prompt, the server tool list, the tool trace and the final answer, and picks a status from the earlier report taxonomy. The agent and judge share a model family, so judge bias is possible. The rule-based column is a cross-check.',
    'Winner ranking: Pass > Partial Pass > Ungrounded > Partial Fail > Capability Gap > Fail = Fail (Bug), matching the earlier report where a missing tool beats an attempted failure. Rows where drk hit a bug and the official server had no tool are a wash.',
    'Single run per prompt: results vary run to run. Mutating prompts (create asset/geofence/road restriction) run against the drk server with the supplied API key; cleanup.mjs deletes what they create.',
    'Costs are Claude Code estimates (total_cost_usd) and may differ from billing; subscription plans may meter differently.',
], 1):
    c = w3.cell(i, 1, l); c.alignment = wrap; w3.row_dimensions[i].height = 58
w3.column_dimensions['A'].width = 140
wb.save(OUTFILE)
print('saved', OUTFILE, len(done), 'prompts;', Counter(x['win'] for x in done))
for s in ('off', 'drk'): print(s, Counter(x[s]['status'] for x in done))
