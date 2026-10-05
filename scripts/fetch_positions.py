#!/usr/bin/env python3
"""Collect ALL open research positions from big job portals into data/positions.json.

Runs daily in GitHub Actions, which has full internet access. Sources:
  - Bandi MUR (Italy): incarichi post-doc, incarichi di ricerca, RTD/RTT, all subjects
  - EURAXESS (Europe): computer-science-related job offers
  - jobs.ac.uk (UK): research jobs matching ML/AI/data keywords

Every position gets a relevance score against the candidate's topics (KEYWORDS below),
so the app can show "relevant to me" by default and everything else on request.
Detail pages are fetched once and cached in the output file between runs.

Usage:  python3 scripts/fetch_positions.py [--out data/positions.json] [--fixtures DIR]
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/126 Safari/537.36 Careerly/1.0 (personal job tracker)')
TODAY = dt.date.today()
DELAY = 0.4  # seconds between requests, to be polite

# ---------------------------------------------------------------------------
# Relevance: (regex, weight). Matched case-insensitively against title,
# description, field and sector. Weight >= 3 in total => "relevant".
# ---------------------------------------------------------------------------
KEYWORDS = [
    # strong, core topics
    (r'\blarge language models?\b|\bLLMs?\b', 4),
    (r'\bsentence[- ]transformers?\b|\b(?:text|sentence|semantic) embeddings?\b', 4),
    (r'\bdata imputation\b|\bmissing (?:data|values)\b|\bimputazione\b', 4),
    (r'\bentity (?:resolution|matching)\b|\brecord linkage\b', 4),
    (r'\bdata quality\b|\bqualit[àa] de[il] dati\b|\bdata cleaning\b|\bdata validation\b', 4),
    (r'\bmachine learning\b|\bapprendimento automatico\b', 3),
    (r'\bdeep learning\b|\bapprendimento profondo\b', 3),
    (r'\bnatural language processing\b|\bNLP\b|\blinguaggio naturale\b', 3),
    (r'\btransformers?\b(?! station)', 2),
    (r'\bartificial intelligence\b|\bintelligenza artificiale\b|\bA\.?I\.?\b', 2),
    (r'\bgraph neural networks?\b|\bGNNs?\b|\bknowledge graphs?\b|\bgrafi di conoscenza\b', 3),
    (r'\btrustworthy\b|\bfairness\b|\bexplainab|\bspiegabil|\binterpretab', 2),
    (r'\bgreen AI\b|\benergy[- ]efficient (?:AI|ML|machine learning)\b', 3),
    (r'\banomaly detection\b|\boutlier detection\b|\brilevamento (?:di )?anomalie\b', 3),
    (r'\bneural networks?\b|\breti neurali\b', 2),
    (r'\bdata science\b|\bdata mining\b|\bbig data\b|\bdata management\b|\bdatabases?\b|\bbasi di dati\b', 2),
    (r'\bgenerative AI\b|\bfoundation models?\b|\bretrieval[- ]augmented\b|\bRAG\b', 3),
    (r'\binformation retrieval\b|\bsemantic search\b|\bvector search\b', 2),
    (r'\breinforcement learning\b', 2),
    # sectors / fields
    (r'\bIINF-05\b|\bING-INF/05\b|\bINFO-01\b|\bINF/01\b|\bsistemi di elaborazione delle informazioni\b', 3),
    (r'\bcomputer science\b|\binformatica\b|\bdatabase management\b', 1),
]
KW_RE = [(re.compile(p, re.I), w) for p, w in KEYWORDS]

# Positions to drop entirely (not for a postdoc-level candidate)
EXCLUDE_RE = re.compile(r'\bdottorato\b|(?<!post-)(?<!post)\bPhD\b(?!\W*(?:required|holder|degree|in hand))|\bdoctoral (?:student|candidate|position|researcher)\b|'
                        r'\bstudentships?\b|\bborsa di studio\b|\bmaster\'?s? student\b|\binternships?\b|\btirocinio\b|'
                        r'\btechnician\b|\bteaching fellow\b|\badministrat', re.I)
# jobs.ac.uk lists all kinds of university jobs; keep research roles only
RESEARCH_ROLE_RE = re.compile(r'research|post-?doc|fellow|scientist|investigator|lecturer|professor|ricercat', re.I)


def score(*texts):
    blob = ' '.join(t for t in texts if t)
    total, hits = 0, []
    for rx, w in KW_RE:
        m = rx.search(blob)
        if m:
            total += w
            hits.append(m.group(0))
    return total, sorted(set(h.lower() for h in hits))


# ---------------------------------------------------------------------------
# HTTP + text helpers
# ---------------------------------------------------------------------------
FIXTURES = None
HOST_DELAY = {'euraxess.ec.europa.eu': 2.5}  # EURAXESS rate-limits quickly


class RateLimited(Exception):
    pass


def get(url, retries=2):
    if FIXTURES:
        key = hashlib.md5(url.encode()).hexdigest()
        try:
            return open(f'{FIXTURES}/{key}.html', encoding='utf-8', errors='replace').read()
        except FileNotFoundError:
            return ''
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en,it;q=0.8'})
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read().decode(r.headers.get_content_charset() or 'utf-8', errors='replace')
            time.sleep(HOST_DELAY.get(urllib.parse.urlparse(url).hostname, DELAY))
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RateLimited(url) from e
            if e.code == 404 or attempt == retries:
                if e.code != 404:
                    print(f'  ! {url}: {e}', file=sys.stderr)
                return ''
            time.sleep(2 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            if attempt == retries:
                print(f'  ! {url}: {e}', file=sys.stderr)
                return ''
            time.sleep(2 * (attempt + 1))
    return ''


def text(s):
    s = re.sub(r'<(script|style)\b.*?</\1>', ' ', s or '', flags=re.S | re.I)
    s = re.sub(r'<br\s*/?>|</p>|</div>|</li>|</h\d>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t\xa0]+', ' ', s)
    return re.sub(r'\n\s*\n+', '\n', s).strip()


def short(s, n=600):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return s if len(s) <= n else s[:n].rsplit(' ', 1)[0] + '…'


MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def parse_date(s):
    """Accepts 31/12/2026, 2026-12-31, '5 Nov 2026', '09 Oct' (assumes next occurrence)."""
    if not s:
        return ''
    s = s.strip()
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m:
        d, mo, y = map(int, m.groups())
        return f'{y:04d}-{mo:02d}-{d:02d}'
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return m.group(0)
    m = re.search(r'(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?', s)
    if m and m.group(2).lower()[:3] in MONTHS:
        d, mo = int(m.group(1)), MONTHS[m.group(2).lower()[:3]]
        y = int(m.group(3)) if m.group(3) else TODAY.year
        try:
            date = dt.date(y, mo, d)
        except ValueError:
            return ''
        if not m.group(3) and date < TODAY - dt.timedelta(days=60):
            date = dt.date(y + 1, mo, d)
        return date.isoformat()
    return ''


TIME_RE = re.compile(r'(?:\bore|\bh\.?|\balle|\bat|-|,)\s*(\d{1,2})[:.](\d{2})\b|\b(\d{1,2})[:.](\d{2})\s*(?:h\b|CET|CEST|\()', re.I)
TZ_RE = re.compile(r'\(([A-Z][A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?)\)')
COUNTRY_TZ = {
    'United Kingdom': 'Europe/London', 'Ireland': 'Europe/Dublin', 'Portugal': 'Europe/Lisbon',
    'Iceland': 'Atlantic/Reykjavik', 'Finland': 'Europe/Helsinki', 'Estonia': 'Europe/Tallinn',
    'Latvia': 'Europe/Riga', 'Lithuania': 'Europe/Vilnius', 'Greece': 'Europe/Athens',
    'Romania': 'Europe/Bucharest', 'Bulgaria': 'Europe/Sofia', 'Cyprus': 'Asia/Nicosia',
}


def parse_time(s):
    """'31 Oct 2026 - 13:00 (Europe/Brussels)' -> ('13:00', 'Europe/Brussels'); ('', '') when not stated."""
    m = TIME_RE.search(s or '')
    t = ''
    if m:
        h, mi = (int(m.group(1)), int(m.group(2))) if m.group(1) else (int(m.group(3)), int(m.group(4)))
        if (h, mi) == (24, 0):
            h, mi = 23, 59
        if h < 24 and mi < 60:
            t = f'{h:02d}:{mi:02d}'
    z = TZ_RE.search(s or '')
    tz = z.group(1) if z else ''
    try:
        if tz:
            ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        tz = ''
    return t, tz


def deadline_moment(p):
    """When the call closes: deadline date + time (23:59 if not stated) in the call's time zone."""
    d = p.get('deadline') or ''
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
        return None
    t = p.get('deadlineTime') or '23:59'
    tz = p.get('deadlineTz') or COUNTRY_TZ.get(p.get('country', ''), 'Europe/Rome')
    try:
        return dt.datetime.fromisoformat(f'{d}T{t}:59' if t == '23:59' else f'{d}T{t}:00').replace(tzinfo=ZoneInfo(tz))
    except (ValueError, KeyError):
        return None


def is_open(p):
    """Accepts a position dict (or a bare deadline string)."""
    if isinstance(p, str) or p is None:
        p = {'deadline': p or ''}
    m = deadline_moment(p)
    return m is None or m > dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------------------
# Bandi MUR
# ---------------------------------------------------------------------------
MUR = 'https://bandi.mur.gov.it'
MUR_SECTIONS = [
    # (script, kind label, position type, status param name)
    ('incarichipostdoc.php', 'Incarico post-doc', 'Postdoc', 'jf_comp_status_id'),
    ('incarichidiricerca.php', 'Incarico di ricerca', 'Researcher / Research Scientist', 'jf_comp_status_id'),
    ('bandi.php', 'Assegno di ricerca', 'Research Fellow', 'jf_comp_status_id'),
    ('jobs.php', 'Ricercatore a tempo determinato', 'Researcher / Research Scientist', 'jv_comp_status_id'),
]

MUR_LABELS = {
    'title_en': ['Titolo del progetto di ricerca in inglese', 'Titolo in inglese', 'Titolo inglese'],
    'title_it': ['Titolo del progetto di ricerca in italiano', 'Titolo'],
    'desc_en': ['Descrizione sintetica in inglese', 'Descrizione in inglese'],
    'desc_it': ['Descrizione sintetica in italiano', 'Descrizione in italiano', 'Descrizione'],
    'ssd': ['S.S.D', 'S.S.D.', 'Settore scientifico disciplinare', 'Settore'],
    'area': ['Settore Concorsuale', 'Gruppo scientifico disciplinare'],
    'site': ['Sito web del bando', 'Link al bando', 'Sito web'],
    'amount': ['Importo annuale', 'Importo'],
    'duration': ['Massima durata dell\'assegno', 'Durata', 'Durata in mesi', 'Durata del contratto'],
    'city': ['Sede', 'Città', 'Sede di servizio'],
    'deadline': ['Data di scadenza', 'Scadenza bando', 'Scadenza del bando', 'Scadenza', 'Data scadenza'],
}


def mur_detail(url):
    raw = get(url)
    if not raw:
        return {}
    segs = [re.sub(r'\s+', ' ', html.unescape(x)).strip() for x in re.split(r'<[^>]+>', re.sub(r'<(script|style)\b.*?</\1>', '', raw, flags=re.S))]
    segs = [s for s in segs if s and s not in ('-->', '<!--')]
    out = {}
    for key, labels in MUR_LABELS.items():
        for i, s in enumerate(segs[:-1]):
            if any(s.lower().startswith(lb.lower()) and len(s) <= len(lb) + 3 for lb in labels):
                val = segs[i + 1]
                if val.startswith('(') and i + 2 < len(segs):  # skip "(breve descrizione)" hints
                    val = segs[i + 2]
                if key not in out and val and not any(val.lower().startswith(lb.lower()) for lbs in MUR_LABELS.values() for lb in lbs):
                    out[key] = val
                    break
    m = re.search(r'https?://[^\s"\'<>|]+', out.get('site', ''))
    out['site'] = m.group(0) if m else ''
    return out


MUR_DETAIL_BUDGET = 25 * 60  # seconds per run for reading call pages; the rest continue tomorrow


def fetch_mur(cache):
    items = []
    t0 = time.time()
    fetched = 0
    for script, kind, ptype, status_param in MUR_SECTIONS:
        url = (f'{MUR}/{script}/public/' + ('cercaJobs' if script == 'jobs.php' else 'cercaFellowship')
               + f'?{status_param}=2-3&bb_type_code=%25&azione=cerca')
        page = get(url)
        found = re.search(r'trovati (\d+) bandi', page)
        blocks = re.findall(r'<p>\s*<em class="aperto">(.*?)</p>', page, flags=re.S)
        print(f'  MUR {kind}: {found.group(1) if found else "?"} listed, {len(blocks)} parsed', flush=True)
        for b in blocks:
            link = re.search(r'href="(/[^"]+/id_(?:fellow|job)/(\d+))">(.*?)</a>', b, flags=re.S)
            if not link:
                continue
            path, num, title = link.group(1), link.group(2), text(link.group(3))
            dl = re.search(r'scade il ([\d/]+)([^<]{0,40})', b)
            deadline = parse_date(dl.group(1)) if dl else ''
            dl_time = parse_time(dl.group(2))[0] if dl else ''
            inst = text(re.search(r'<strong>(.*?)</strong>', b, flags=re.S).group(1)) if '<strong>' in b else ''
            settore = re.findall(r'<strong>\s*(?:Settore|S\.S\.D\.)\s*(.*?)</strong>', b, flags=re.S)
            pid = f'mur-{script.split(".")[0]}-{num}'
            det = cache.get(pid, {}).get('_detail')
            store = det is not None
            if det is None and time.time() - t0 < MUR_DETAIL_BUDGET:
                det = mur_detail(MUR + path)
                fetched += 1
                store = bool(det)
            det = det or {}
            title_en = det.get('title_en', '')
            desc = det.get('desc_en') or det.get('desc_it') or ''
            field = ' / '.join(x for x in [text(settore[0]) if settore else '', det.get('ssd', ''), det.get('area', '')] if x)
            sc, hits = score(title, title_en, desc, field)
            if not dl_time and det.get('deadline') and parse_date(det['deadline']) == deadline:
                dl_time = parse_time(det['deadline'])[0]
            items.append({
                'id': pid, 'source': 'Bandi MUR', 'kind': kind, 'type': ptype,
                'title': title_en if title_en and len(title) < 25 else title,
                'titleAlt': title_en if title_en and title_en != title else '',
                'institution': inst, 'country': 'Italy', 'city': det.get('city', ''),
                'deadline': deadline, 'deadlineTime': dl_time, 'deadlineTz': 'Europe/Rome',
                'url': MUR + path, 'applyUrl': det.get('site', ''),
                'field': short(field, 200), 'summary': short(desc, 500),
                'salary': (det.get('amount', '') + ' € / year') if det.get('amount', '').isdigit() else det.get('amount', ''),
                'duration': det.get('duration', ''),
                'score': sc, 'matched': hits, **({'_detail': det} if store else {}),
            })
    print(f'  MUR: read {fetched} call pages this run ({int(time.time() - t0)}s)', flush=True)
    return items


# ---------------------------------------------------------------------------
# jobs.ac.uk
# ---------------------------------------------------------------------------
JAC = 'https://www.jobs.ac.uk'
JAC_QUERIES = ['machine learning', 'deep learning', 'artificial intelligence', 'large language models',
               'natural language processing', 'data science', 'data quality', 'trustworthy AI',
               'graph neural networks', 'knowledge graphs']


def fetch_jobsacuk(cache):
    seen, items = set(), []
    for q in JAC_QUERIES:
        for start in range(1, 201, 25):  # up to 8 pages per query
            url = f'{JAC}/search/?keywords={urllib.parse.quote_plus(q)}&sortOrder=1&pageSize=25&startIndex={start}'
            page = get(url)
            results = page.split('class="j-search-result__result')[1:]
            new = 0
            for r in results:
                link = re.search(r'href="(/job/([A-Z0-9]+)/[^"]+)"\s*>\s*(.*?)</a>', r, flags=re.S)
                if not link or link.group(2) in seen:
                    continue
                seen.add(link.group(2))
                new += 1
                title = text(link.group(3))
                dept = text((re.search(r'j-search-result__department">(.*?)</div>', r, flags=re.S) or [None, ''])[1])
                emp = text((re.search(r'j-search-result__employer">(.*?)</div>', r, flags=re.S) or [None, ''])[1])
                loc = text((re.search(r'Location:\s*(.*?)</div>', r, flags=re.S) or [None, ''])[1])
                sal = text((re.search(r'Salary:\s*</strong>(.*?)</div>', r, flags=re.S) or [None, ''])[1])
                closes = text((re.search(r'date--blue[^>]*>(.*?)</span>', r, flags=re.S) or [None, ''])[1])
                deadline = parse_date(closes)
                dl_time = parse_time(closes)[0]
                if EXCLUDE_RE.search(title) or not RESEARCH_ROLE_RE.search(title):
                    continue
                sc, hits = score(title, dept)
                ptype = ('Research Fellow' if re.search(r'fellow', title, re.I) else
                         'Postdoc' if re.search(r'postdoc|post-doc|research associate|research assistant', title, re.I) else
                         'Researcher / Research Scientist' if re.search(r'research', title, re.I) else 'Other')
                items.append({
                    'id': f'jac-{link.group(2)}', 'source': 'jobs.ac.uk', 'kind': '', 'type': ptype,
                    'title': title, 'titleAlt': '', 'institution': emp, 'country': 'United Kingdom',
                    'city': loc, 'deadline': deadline, 'deadlineTime': dl_time, 'deadlineTz': 'Europe/London',
                    'url': JAC + link.group(1), 'applyUrl': '',
                    'field': dept, 'summary': '', 'salary': sal, 'duration': '',
                    'score': sc, 'matched': hits,
                })
            if len(results) < 25 or new == 0:
                break
    print(f'  jobs.ac.uk: {len(items)} positions')
    return items


# ---------------------------------------------------------------------------
# EURAXESS
# The search page ignores filters and paging for automated requests (it always returns
# the 10 newest offers), so we read the newest offer id from it and then visit new
# offer pages one by one (ids are sequential), politely, remembering where we stopped.
# ---------------------------------------------------------------------------
EUX = 'https://euraxess.ec.europa.eu'
EUX_BACKFILL = 1200      # how far back to start on the very first run
EUX_MAX_PER_RUN = 300    # offers read per run (~2.5 s each); a backlog is caught up over several days
EUX_BUDGET = 20 * 60     # seconds per run
EUX_KEEP_FIELDS = re.compile(r'computer|informatic|database|engineering|mathemat|statist|modelling|information|'
                             r'communication|technology|linguistic|language', re.I)


def eux_offer(num):
    raw = get(f'{EUX}/jobs/{num}')
    if not raw or 'ecl-description-list' not in raw:
        return None
    pairs = {}
    for k, v in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', raw, flags=re.S):
        k = text(k)
        if k and k not in pairs:
            pairs[k] = text(v)
    h1 = [text(x) for x in re.findall(r'<h1[^>]*>(.*?)</h1>', raw, flags=re.S)]
    title = next((x for x in h1 if x and x.lower() != 'job offer'), '')
    desc = ''
    m = re.search(r'id="offer-description"[^>]*>(.*?)(?:<h2|$)', raw, flags=re.S)
    if m:
        desc = re.sub(r'^\s*Offer Description\s*', '', text(m.group(1)))
    return {
        'title': title,
        'institution': pairs.get('Organisation/Company') or pairs.get('Company/Institute', ''),
        'field': pairs.get('Research Field', ''),
        'profile': pairs.get('Researcher Profile', ''),
        'deadline': parse_date(pairs.get('Application Deadline', '')),
        'deadlineTime': parse_time(pairs.get('Application Deadline', ''))[0],
        'deadlineTz': parse_time(pairs.get('Application Deadline', ''))[1],
        'country': pairs.get('Country', ''),
        'city': pairs.get('City', ''),
        'contract': pairs.get('Type of Contract', ''),
        'summary': short(desc, 600),
    }


def fetch_euraxess(cache):
    newest = [int(x) for x in re.findall(r'href="/jobs/(\d+)"', get(EUX + '/jobs/search'))]
    if not newest:
        raise RuntimeError('could not read the newest offer id')
    top = max(newest)
    last = cache.get('_eux_state', {}).get('_detail', {}).get('lastId')
    backfill = last is None
    if backfill:
        last = top - EUX_BACKFILL
    start = max(last + 1, top - (EUX_BACKFILL if backfill else EUX_MAX_PER_RUN) + 1)
    end = min(top, start + EUX_MAX_PER_RUN - 1)
    print(f'  EURAXESS: newest offer {top}; reading {start}..{end}', flush=True)
    items, checked, done_until, t0 = [], 0, start - 1, time.time()
    for num in range(start, end + 1):
        if time.time() - t0 > EUX_BUDGET:
            print('  EURAXESS: time budget used; continuing tomorrow')
            break
        try:
            o = eux_offer(num)
        except RateLimited:
            print(f'  EURAXESS: rate-limited at {num}; stopping politely, will continue tomorrow')
            break
        checked += 1
        done_until = num
        if not o:
            continue
        pid = f'eux-{num}'
        if EXCLUDE_RE.search(o['title']):
            continue
        sc, hits = score(o['title'], o['summary'], o['field'])
        if sc == 0 and not EUX_KEEP_FIELDS.search(o['field']):
            continue  # unrelated discipline (e.g. history, biology); skip to keep the file small
        ptype = ('MSCA Postdoctoral Fellowship' if re.search(r'\bMSCA\b|Marie', o['title']) else
                 'Postdoc' if re.search(r'post-?doc', o['title'], re.I) or 'R2' in o['profile'] else
                 'Research Fellow' if re.search(r'fellow', o['title'], re.I) else
                 'PhD position' if 'R1' in o['profile'] and re.search(r'phd|doctoral', o['title'], re.I) else
                 'Researcher / Research Scientist')
        items.append({
            'id': pid, 'source': 'EURAXESS', 'kind': o['profile'], 'type': ptype,
            'title': o['title'], 'titleAlt': '', 'institution': o['institution'],
            'country': o['country'], 'city': o['city'], 'deadline': o['deadline'],
            'deadlineTime': o['deadlineTime'], 'deadlineTz': o['deadlineTz'] or ('Europe/Brussels' if o['deadlineTime'] else ''),
            'url': f'{EUX}/jobs/{num}', 'applyUrl': '', 'field': o['field'],
            'summary': o['summary'], 'salary': '', 'duration': o['contract'],
            'score': sc, 'matched': hits,
            **({'firstSeen': (TODAY - dt.timedelta(days=1)).isoformat()} if backfill else {}),
        })
    cache['_eux_state'] = {'_detail': {'lastId': done_until, 'newest': top}}
    print(f'  EURAXESS: {checked} offers read, {len(items)} kept; {top - done_until} still to read', flush=True)
    return items


# ---------------------------------------------------------------------------
def main():
    global FIXTURES
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='data/positions.json')
    ap.add_argument('--fixtures')
    ap.add_argument('--only', help='comma-separated: mur,jac,eux')
    args = ap.parse_args()
    FIXTURES = args.fixtures

    try:
        old = json.load(open(args.out, encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        old = {'positions': [], 'sources': {}}
    cache = {p['id']: p for p in old.get('positions', [])}
    # carry over detail caches that are stored separately to keep the main file small
    try:
        details = json.load(open(args.out.replace('.json', '-cache.json'), encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        details = {}
    for pid, det in details.items():
        cache.setdefault(pid, {})['_detail'] = det

    fetchers = {'mur': ('Bandi MUR', fetch_mur), 'jac': ('jobs.ac.uk', fetch_jobsacuk), 'eux': ('EURAXESS', fetch_euraxess)}
    only = set(args.only.split(',')) if args.only else set(fetchers)
    sources = dict(old.get('sources', {}))
    had = {p.get('source') for p in old.get('positions', [])}
    yesterday = (TODAY - dt.timedelta(days=1)).isoformat()
    done = {}  # source name -> fresh list

    def previous(name):
        return [dict(p) for p in old.get('positions', []) if p.get('source') == name and is_open(p)]

    def save():
        """Write the output now, using fresh data where collected and yesterday's otherwise."""
        positions, details = [], {}
        for _, (name, _) in fetchers.items():
            for p in (done[name] if name in done else previous(name)):
                if not is_open(p):
                    continue
                p = dict(p)
                p['firstSeen'] = (cache.get(p['id'], {}).get('firstSeen') or p.get('firstSeen')
                                  or (TODAY.isoformat() if name in had else yesterday))
                p['relevant'] = p['score'] >= 3
                if '_detail' in p:
                    details[p['id']] = p.pop('_detail')
                elif p['id'] in cache and '_detail' in cache[p['id']]:
                    details[p['id']] = cache[p['id']]['_detail']
                positions.append(p)
        if '_eux_state' in cache:
            details['_eux_state'] = cache['_eux_state']['_detail']
        positions.sort(key=lambda p: (not p['relevant'], p['deadline'] or '9999'))
        out = {
            'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'sources': sources,
            'counts': {'total': len(positions), 'relevant': sum(p['relevant'] for p in positions)},
            'positions': positions,
        }
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=0)
            f.write('\n')
        with open(args.out.replace('.json', '-cache.json'), 'w', encoding='utf-8') as f:
            json.dump(details, f, ensure_ascii=False, separators=(',', ':'))
        return out

    for key, (name, fn) in fetchers.items():
        if key not in only:
            continue
        print(f'Fetching {name}…', flush=True)
        try:
            got = [p for p in fn(cache) if is_open(p)]
            if key == 'eux':  # incremental: keep earlier offers that are still open
                ids = {p['id'] for p in got}
                got += [p for p in previous(name) if p['id'] not in ids]
            done[name] = got
            sources[name] = {'ok': True, 'count': len(got), 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
        except Exception as e:  # keep yesterday's data for this source if it breaks
            print(f'  ! {name} failed: {e}', file=sys.stderr)
            sources[name] = {**sources.get(name, {}), 'ok': False, 'error': str(e)[:200]}
        save()  # checkpoint after every source

    out = save()
    print(f'Done: {out["counts"]["total"]} open positions, {out["counts"]["relevant"]} relevant.')


if __name__ == '__main__':
    main()
