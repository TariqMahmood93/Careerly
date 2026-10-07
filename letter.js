/* Scholarly: cover-letter drafts (.docx) and the required-documents check.
 *
 * Cover letter: built in the browser from the tracked call (title, institution, PI, topics,
 * pasted call text) and the user's CV text (kept in their account by positions.js / cloud.js).
 * It names the call's topics the CV covers, quotes the CV lines that best support them, and
 * leaves [bracketed] gaps for what only the applicant can write. The Word file has a second
 * page of preparation notes (deadline, how to submit, documents, topics to address).
 *
 * Documents check: finds the documents and special requirements a call asks for (in English
 * and Italian) in the pasted call text, and adds them to the position's checklist.
 */
(() => {
  'use strict';

  const C = window.Careerly;
  const M = () => window.CareerlyMatch;
  const $ = sel => document.querySelector(sel);
  const { esc } = C;

  let detailId = null;
  C.onDetail(p => { detailId = p.id; });

  // ======================================================================
  // Required documents
  // ======================================================================
  // name: what goes in the checklist; find: wording in calls (EN + IT); same: existing checklist
  // names that already cover it.
  const DOC_RULES = [
    { name: 'CV', find: /curriculum vit|\bc\.\s?v\.|\bcv\b|\bresum[eé]\b/i, same: /^cv\b|curriculum|resum/i },
    { name: 'Cover letter', find: /cover(?:ing)? letter|motivation(?:al)? letter|letter of (?:motivation|interest|intent|application)|statement of (?:interest|motivation|purpose)|lettera (?:di )?motivazion/i, same: /cover|motivation|interest/i },
    { name: 'Research statement / proposal', find: /research (?:statement|proposal|plan|project|interests? statement)|project proposal|proposta (?:di )?progett|progetto di ricerca/i, same: /research (?:statement|proposal|plan|project)|proposal|progetto/i },
    { name: 'Publication list', find: /(?:list|elenco) (?:of |delle |dei )?(?:selected )?(?:publications|pubblicazioni)|publication list|elenco (?:dei )?titoli/i, same: /publication|pubblicazion/i },
    { name: 'Copies of selected publications (PDF)', find: /(?:copies|copy|pdfs?|full[- ]texts?) of (?:up to \w+ |\d+ |your |the )*(?:selected |most relevant |best )?(?:publications|papers)|pubblicazioni[^.\n]{0,60}(?:pdf|in copia|presentate)|(?:up to|max(?:imum)?|massimo) (?:\w+ |\d+ )(?:selected )?(?:publications|pubblicazioni)/i, same: /copies|selected publications|pdf/i },
    { name: 'Reference letters', find: /(?:reference|recommendation|support) letters?|letters? of (?:reference|recommendation|support)|\breferees?\b|lettere? di (?:referenza|raccomandazione|presentazione)|\breferences\b/i, same: /reference|recommendation|referee|referenz|raccomand/i, count: /\b(two|three|four|2|3|4|due|tre|quattro)\s+(?:\w+\s+)?(?:reference|recommendation|letters?|referees?|lettere|referenze)/i },
    { name: 'PhD certificate / degree', find: /ph\.?\s?d\.? (?:certificate|diploma|degree certificate)|doctoral (?:certificate|diploma|degree)|cop(?:y|ies) of (?:the |your )?(?:ph\.?d|doctoral|degree|diploma)|diploma di dottorato|titolo di dottore di ricerca|degree certificates?|certificat[oi] di laurea/i, same: /degree|certificate|diploma|dottorato/i },
    { name: 'Transcripts', find: /transcripts?(?: of records)?|academic records?|esami sostenuti/i, same: /transcript/i },
    { name: 'ID / passport copy', find: /passport|identity (?:card|document)|\bid (?:card|document)\b|documento (?:di |d')(?:identit|riconoscimento)|carta d.identit/i, same: /passport|identity|\bid\b|identit/i },
    { name: 'Application form', find: /application form|modulo (?:di )?domanda|domanda di (?:ammissione|partecipazione)|allegato\s+a\b|online application (?:form|system|portal)|pica\.cineca|piattaforma pica/i, same: /application form|domanda|modulo/i },
    { name: 'Self-declaration (DSAN, D.P.R. 445/2000)', find: /dichiarazion[ei] sostitutiv|autocertificazion|self[- ]declaration|\bdsan\b|d\.?\s?p\.?\s?r\.?\s*(?:n\.?\s*)?445/i, same: /declaration|dichiarazion|dsan|autocert/i },
    { name: 'Teaching statement', find: /teaching (?:statement|philosophy|portfolio)/i, same: /teaching/i },
    { name: 'Diversity statement', find: /diversity (?:statement|and inclusion statement)/i, same: /diversity/i },
    { name: 'PhD thesis abstract', find: /(?:abstract|summary) of (?:the |your )?(?:ph\.?d\.? )?(?:thesis|dissertation)|thesis (?:abstract|summary)|tesi di dottorato/i, same: /thesis|tesi/i },
    { name: 'Summary of research achievements', find: /summary of (?:research )?(?:achievements|accomplishments)|research (?:summary|achievements)|track record/i, same: /achievement|track record|summary of research/i },
    { name: 'Language certificate', find: /\bielts\b|\btoefl\b|language certificat|certificazione linguistica|\bcefr\b/i, same: /language|ielts|toefl/i },
    { name: 'CV in Europass format', find: /europass/i, same: /europass/i },
    { name: 'ORCID iD', find: /\borcid\b/i, same: /orcid/i },
    { name: 'Codice fiscale (Italian tax code)', find: /codice fiscale/i, same: /codice fiscale|tax code/i },
    { name: 'Application fee / marca da bollo receipt', find: /application fee|marca da bollo|contributo (?:di|per la) (?:partecipazione|iscrizione)|versamento/i, same: /fee|bollo|versamento|receipt/i },
  ];

  const NOTE_RULES = [
    [/\bPEC\b|posta elettronica certificata/i, 'May require sending from a PEC (certified email) address, or allow it as an alternative.'],
    [/\bsigned\b|firmat[aoie]\b|firma (?:autografa|digitale)|sottoscritt/i, 'Some documents must be signed. Check whether a digital signature is accepted.'],
    [/(?:single|one|un unico|unico) (?:file )?pdf|(?:merged|combined) into (?:a single|one)/i, 'Documents must be combined into a single PDF.'],
    [/\bcolloquio\b|\binterview\b/i, 'An interview is part of the selection. Note the date when it is announced.'],
    [/(?:max(?:imum)?|no more than|not exceed(?:ing)?|up to|massimo|non superiore a)\s*(?:of\s*)?(\d+)\s*(pages?|pagine|words|parole|characters|caratteri)/i, m => `Length limit: ${m[1]} ${m[2]}.`],
    [/in (?:lingua )?(?:inglese|english)[^.\n]{0,40}(?:o|or) (?:in )?(?:italiano|italian)|in (?:italiano|italian)[^.\n]{0,40}(?:o|or) (?:in )?(?:inglese|english)/i, 'Documents can be written in Italian or English.'],
  ];

  const MONTHS = {
    jan: 1, january: 1, gennaio: 1, feb: 2, february: 2, febbraio: 2, mar: 3, march: 3, marzo: 3,
    apr: 4, april: 4, aprile: 4, may: 5, maggio: 5, jun: 6, june: 6, giugno: 6, jul: 7, july: 7, luglio: 7,
    aug: 8, august: 8, agosto: 8, sep: 9, sept: 9, september: 9, settembre: 9, oct: 10, october: 10, ottobre: 10,
    nov: 11, november: 11, novembre: 11, dec: 12, december: 12, dicembre: 12,
  };
  const DEADLINE_WORDS = /deadline|closing date|closes|scadenza|scade|entro|non oltre|termine|apply by|submitted by|must be received|later than|before/i;

  // Deadline date and time stated near deadline wording
  function findDeadline(text) {
    const out = {};
    const windows = [];
    const re = new RegExp(DEADLINE_WORDS.source, 'gi');
    let m;
    while ((m = re.exec(text)) && windows.length < 20) windows.push(text.slice(m.index, m.index + 160));
    for (const w of windows) {
      if (!out.time) {
        const t = w.match(/(?:\bore|\bh\.?|\bat|\bby|\balle|,)\s*(\d{1,2})[:.](\d{2})\b|\b(\d{1,2})[:.](\d{2})\s*(?:h\b|hrs\b|CET|CEST|GMT|BST|UTC|\(?(?:local|rome|italian|brussels|uk)? ?time)|\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i);
        if (t) {
          let h, mi;
          if (t[1]) { h = +t[1]; mi = +t[2]; } else if (t[3]) { h = +t[3]; mi = +t[4]; } else { h = +t[5] % 12 + (/p/i.test(t[6]) ? 12 : 0); mi = 0; }
          if (h === 24 && mi === 0) { h = 23; mi = 59; }
          if (h < 24 && mi < 60) out.time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
        } else if (/midnight|mezzanotte/i.test(w)) out.time = '23:59';
        else if (/\bnoon\b|mezzogiorno/i.test(w)) out.time = '12:00';
      }
      if (!out.date) {
        let d = w.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d)\b/);
        if (d) out.date = iso(+d[3], +d[2], +d[1]);
        else if ((d = w.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?,?\s+(20\d\d)\b/i)) && MONTHS[d[2].toLowerCase()]) out.date = iso(+d[3], MONTHS[d[2].toLowerCase()], +d[1]);
        else if ((d = w.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/i)) && MONTHS[d[1].toLowerCase()]) out.date = iso(+d[3], MONTHS[d[1].toLowerCase()], +d[2]);
      }
      if (out.time && out.date) break;
    }
    return out;
  }
  function iso(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function analyseCall(text, p) {
    const docs = [];
    for (const r of DOC_RULES) {
      const m = text.match(r.find);
      if (!m) continue;
      let name = r.name;
      if (r.count) {
        const c = text.match(r.count);
        if (c) {
          const n = { two: 2, three: 3, four: 4, due: 2, tre: 3, quattro: 4 }[c[1].toLowerCase()] || +c[1];
          if (n) name = `${name} (${n})`;
        }
      }
      docs.push({ rule: r, name, quote: snippet(text, m.index, m[0].length) });
    }
    const notes = [];
    for (const [rx, msg] of NOTE_RULES) {
      const m = text.match(rx);
      if (m) notes.push(typeof msg === 'function' ? msg(m) : msg);
    }
    const typical = [];
    if (p.country === 'Italy') {
      ['Application form', 'Self-declaration (DSAN, D.P.R. 445/2000)', 'ID / passport copy', 'Publication list']
        .forEach(n => { if (!docs.some(d => d.rule.name === n)) typical.push(DOC_RULES.find(r => r.name === n)); });
    }
    return { docs, notes, deadline: findDeadline(text), typical };
  }

  function snippet(text, i, len) {
    const a = Math.max(0, text.lastIndexOf('\n', i) + 1, i - 70);
    let b = text.indexOf('\n', i + len);
    if (b < 0 || b > i + len + 90) b = Math.min(text.length, i + len + 90);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
  }

  const hasDoc = (p, rule) => (p.docs || []).some(d => rule.same.test(d.name) || d.name.toLowerCase() === rule.name.toLowerCase());

  function knownText(p) {
    return [p.callText, p.procedure, p.notes, p.emailSubject].filter(Boolean).join('\n');
  }

  function openDocsCheck() {
    const p = C.get(detailId);
    if (!p) return;
    $('#docs-text').value = '';
    const link = $('#docs-open-call');
    link.hidden = !(p.callUrl || p.applyUrl);
    link.href = p.applyUrl || p.callUrl || '#';
    $('#docs-dialog').showModal();
    runCheck({ fromKnown: true });
    $('#docs-text').focus();
  }

  function runCheck({ fromKnown = false } = {}) {
    const p = C.get(detailId);
    if (!p) return;
    const pasted = $('#docs-text').value.trim();
    if (!fromKnown && !pasted) { $('#docs-result').innerHTML = '<p class="muted">Paste the call text first.</p>'; return; }
    const text = [pasted, knownText(p)].filter(Boolean).join('\n');
    const res = analyseCall(text, p);
    const added = [], already = [];
    const changes = [];
    C.update(p.id, x => {
      x.docs = x.docs || [];
      for (const d of res.docs) {
        if (hasDoc(x, d.rule)) { already.push(d); continue; }
        x.docs.push({ name: d.name, done: false });
        added.push(d);
      }
      if (pasted && !(x.callText || '').includes(pasted)) x.callText = [x.callText || '', pasted].join('\n\n').trim().slice(0, 20000);
      if (res.deadline.date && !x.deadline) { x.deadline = res.deadline.date; changes.push(`deadline set to ${C.fmtDate(x.deadline)}`); }
      if (res.deadline.time && (!x.deadline || !res.deadline.date || res.deadline.date === x.deadline) && x.deadlineTime !== res.deadline.time) {
        x.deadlineTime = res.deadline.time;
        changes.push(`deadline time set to ${res.deadline.time} (${C.tzOf(x).split('/').pop().replace('_', ' ')} time)`);
      }
      if (pasted && res.notes.length) {
        const fresh = res.notes.filter(n => !(x.notes || '').includes(n));
        if (fresh.length) x.notes = [(x.notes || '').trim(), ...fresh.map(n => `• ${n}`)].filter(Boolean).join('\n');
      }
    });
    const after = C.get(p.id);
    const d = res.deadline;
    const other = d.date && after.deadline && d.date !== after.deadline
      ? { date: d.date, time: d.time || '' } : null;
    const typical = res.typical.filter(r => !hasDoc(after, r));
    const li = d => `<li><strong>${esc(d.name)}</strong><br><small class="muted">“${esc(d.quote)}”</small></li>`;
    $('#docs-result').innerHTML = `
      ${added.length ? `<h4>✅ Added to the checklist</h4><ul class="docs-found">${added.map(li).join('')}</ul>` : ''}
      ${already.length ? `<h4>Already on the checklist</h4><ul class="docs-found">${already.map(li).join('')}</ul>` : ''}
      ${!res.docs.length ? `<p class="muted">${pasted ? 'No document requirements were recognised in this text.' : 'We know little about this call yet. Paste its text above (from the call page or the bando PDF) and press Check.'}</p>` : ''}
      ${changes.length ? `<h4>⏰ Deadline</h4><p>${esc(changes.join('; '))}.</p>` : ''}
      ${other ? `<h4>⏰ Different deadline in this text</h4><p>The text says <strong>${esc(C.fmtDate(other.date))}${other.time ? `, ${esc(other.time)}` : ''}</strong>;
        this position has ${esc(C.fmtDeadline(after))}. <button type="button" class="btn small" data-use-deadline="${esc(other.date)}|${esc(other.time)}">Use ${esc(C.fmtDate(other.date))}${other.time ? ` ${esc(other.time)}` : ''}</button></p>` : ''}
      ${res.notes.length ? `<h4>⚠️ Watch out</h4><ul>${res.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${typical.length ? `<h4>Usually needed for Italian calls</h4><p class="muted">Not found in the text above; check the bando.</p>
        <div class="typical">${typical.map(r => `<button type="button" class="btn small" data-add-doc="${esc(r.name)}">+ ${esc(r.name)}</button>`).join(' ')}</div>` : ''}`;
  }

  // ======================================================================
  // Cover letter
  // ======================================================================
  function cvLines(cv) {
    const out = [];
    for (const raw of cv.split(/\n+/)) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (line.length < 25) continue;
      if (line.length <= 260) { out.push(line); continue; }
      line.split(/(?<=[.;])\s+(?=[A-Z])/).forEach(s => { if (s.length >= 25 && s.length <= 300) out.push(s); });
    }
    return out;
  }

  function guessMe(cv) {
    const lines = cv.split('\n').map(x => x.trim()).filter(Boolean);
    const name = lines.slice(0, 6).find(l => /^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,3}$/u.test(l) && !/curriculum|vitae|resume/i.test(l)) || '';
    const email = (cv.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
    const phone = ((cv.match(/(?:\+|00)\d{1,3}[\s.-]?\(?\d[\d\s().-]{6,}\d/) || [''])[0]).trim();
    const ROLE = /post-?doc|research (?:fellow|associate|assistant|scientist|engineer)|researcher|assegnista|lecturer|assistant professor|scientist/i;
    const NOW = /present|current|now|ongoing|today|attuale|in corso|[-–—]\s*$/i;
    let role = '';
    for (let i = 0; i < lines.length && !role; i++) {
      if (ROLE.test(lines[i]) && (NOW.test(lines[i]) || NOW.test(lines[i + 1] || '') || NOW.test(lines[i - 1] || '')) && lines[i].length < 140) {
        role = lines[i].replace(/\(?\b(?:19|20)\d\d\b.*$/, '').replace(/[\s,–—|-]+$/, '').trim();
      }
    }
    return { name, email, phone, role };
  }

  const withArticle = r => {
    r = r.replace(/,\s*(?=(?:University|Universit|Institute|Istituto|Politecnico|Centre|Center|School|College|Laboratory|Lab)\b)/, ' at the ')
      .replace(/ at the (Universit[àa]|Politecnico|Istituto)\b/, ' at $1');
    return /^(a|an|the|working|employed|based|at|in)\b/i.test(r) ? r : `${/^[aeiou]/i.test(r) ? 'an' : 'a'} ${r}`;
  };
  // Procedural words in calls (EN + IT) that are never research topics
  const PROCEDURAL = new Set(`domanda domande tramite allegati allegato allegare candidati candidato candidate candidates bando
    ammissione documento documenti validita firmato firmata datato presentata presentare piattaforma sensi entro oltre ore
    lettere lettera certificazione dichiarazione sostitutiva pagine massimo formato europeo copia corso invio inviare pec
    selezione commissione colloquio titoli valutazione punteggio requisiti decreto articolo art scadenza vincitore
    applicants applicant application applications submit submission submitted deadline documents document letters letter
    referees interview selection committee eligibility requirements required requirement attach attached pages format
    signed copy contract salary gross month months annual pica cineca codice albo titulus`.split(/\s+/));
  // Single words that are too vague to name as "the project's focus"
  const VAGUE = new Set(`publications publication processing developed developing development python pytorch java sql spark
    data learning model models modelling network networks method methods results result analysis tables table relational
    baselines baseline accuracy improving improved pipeline pipelines scale public administration proceedings computer
    science engineering software programming implementation evaluation framework frameworks techniques performance`.split(/\s+/));
  const list = xs => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const topicCase = t => t.split(' ').map(w => /^(llms?|nlp|ai|ml|gnns?|rag|iot|cv|bert|gpt|hpc|xai)$/i.test(w) ? w.toUpperCase().replace(/S$/, 's') : w).join(' ');

  function analyse(p, personal) {
    const norm = M().norm;
    const callText = [p.title, p.keywords, p.group, p.procedure, p.callText, (p.notes || '').replace(/^Found on:.*$/m, '')].filter(Boolean).join('\n');
    const callN = norm(callText);
    const cv = personal.cvText || '';
    const cvN = norm(cv);
    // CV topics that the call mentions, strongest first
    const matched = (personal.terms || []).filter(x => callN.includes(` ${norm(x.t).trim()} `))
      .filter(x => x.custom || x.t.includes(' ') || !VAGUE.has(x.t)).map(x => x.t);
    // the call's own topics (rarer across all positions = more specific)
    const callTerms = M().terms(callText).map(x => x.t).filter(t => !/^\d|^(?:call|application|candidate|applicant|deadline|salary|contract)\b/.test(t));
    // plus multi-word topics of the call that appear in the CV (single words are too vague)
    for (const t of callTerms) if (t.includes(' ') && cvN.includes(` ${t} `) && !matched.includes(t) && matched.length < 8) matched.push(t);
    const gaps = callTerms.filter(t => !cvN.includes(` ${t} `) && !matched.some(m => m.includes(t) || t.includes(m))
      && !t.split(' ').some(w => PROCEDURAL.has(w) || w.length < 3)).slice(0, 6);
    // CV lines that best support the matched topics
    const weights = new Map((personal.terms || []).map(x => [x.t, x.w]));
    const scored = cvLines(cv).map(line => {
      const ln = norm(line);
      let s = 0;
      const hits = [];
      for (const t of matched) if (ln.includes(` ${norm(t).trim()} `)) { s += weights.get(t) || 2; hits.push(t); }
      return { line, s, hits };
    }).filter(x => x.s > 0 && !/@|https?:|\+\d{2}/.test(x.line)).sort((a, b) => b.s - a.s);
    const evidence = [];
    for (const x of scored) {
      if (evidence.length >= 3) break;
      if (evidence.some(e => e.hits.join() === x.hits.join() || e.line.slice(0, 40) === x.line.slice(0, 40))) continue;
      evidence.push(x);
    }
    return { matched, gaps, evidence, strengths: strengthsOf(cv, personal) };
  }

  // What the applicant works on: the CV's "Research interests" line if there is one, else its strongest topics
  function strengthsOf(cv, personal) {
    const lines = cv.split('\n').map(l => l.trim());
    const i = lines.findIndex(l => /^(?:research interests?|research areas?|areas of (?:interest|expertise)|interessi di ricerca|expertise|research focus)\b/i.test(l));
    if (i >= 0) {
      const rest = lines[i].replace(/^[^:]*(?::|$)/, '').trim() || lines.slice(i + 1).find(Boolean) || '';
      const items = rest.split(/[,;•·|]/).map(x => x.replace(/\.$/, '').trim()).filter(x => x && x.length < 50);
      if (items.length >= 2) return items.slice(0, 4).map(x => x.charAt(0).toLowerCase() + x.slice(1));
    }
    const header = M().norm(lines.slice(0, 5).join(' '));
    return (personal.terms || []).map(x => x.t)
      .filter(t => !header.includes(` ${t} `))
      .filter((t, _, all) => !all.some(o => o !== t && o.startsWith(t + ' '))) // keep "graph neural networks", not "graph neural"
      .slice(0, 4);
  }

  function salutation(p) {
    const pi = (p.pi || '').replace(/\(.*?\)/g, '').trim();
    const m = pi.match(/^(prof(?:essor)?\.?|dr\.?|doctor)\s+(.+)$/i);
    if (m) {
      const surname = m[2].trim().split(/\s+/).pop();
      return /^prof/i.test(m[1]) ? `Dear Professor ${surname},` : `Dear Dr ${surname},`;
    }
    if (pi && pi.split(/\s+/).length <= 4 && !/,/.test(pi)) return `Dear ${pi},`;
    return 'Dear Members of the Selection Committee,';
  }

  // Academic documents worth naming in the letter (forms, IDs and declarations are left out)
  function encloses(p) {
    const docs = (p.docs || []).map(d => d.name)
      .filter(n => !/cover|motivation|application form|declaration|dsan|passport|identity|\bid\b|orcid|codice|fee|bollo|europass/i.test(n));
    const nice = n => /^cv\b/i.test(n) ? 'my CV' : /^(PhD|ORCID)\b/.test(n) ? `my ${n}` : `my ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    const out = [...new Set(docs.map(n => nice(n.replace(/\s*\((\d)\)$/, ''))))];
    return out.length ? out : ['my CV', 'my publication list'];
  }

  function buildLetter(p, personal, me) {
    const a = analyse(p, personal);
    const type = (p.type && !/other/i.test(p.type) ? `${p.type.split('/')[0].trim()} position` : 'research position');
    const ref = p.reference ? ` (Ref. ${p.reference})` : '';
    const where = [p.group, p.institution].filter(Boolean).join(', ');
    const source = ((p.notes || '').match(/^Found on: (.+)$/m) || [])[1];
    const topics = a.matched.slice(0, 4).map(topicCase);
    const strengths = (a.strengths.length ? a.strengths : a.matched).slice(0, 4).map(topicCase);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const head = [me.name || '[Your name]', me.role || '[Your current position]', [me.email, me.phone].filter(Boolean).join(' · ') || '[email · phone]'].join('\n');
    const to = [p.pi ? p.pi : 'Selection Committee', p.group, p.institution, [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean).join('\n');

    const paras = [];
    paras.push(head);
    paras.push(today);
    paras.push(to);
    paras.push(`Subject: Application for the position “${p.title}”${ref}`);
    paras.push(salutation(p));
    paras.push(`I am writing to apply for the ${type} “${p.title}”${ref}${where ? ` at ${where}` : ''}${source && !/claude/i.test(source) ? `, advertised on ${source}` : ''}. ` +
      `I am currently ${me.role ? withArticle(me.role) : '[your current position and institution]'}` +
      `${strengths.length ? `, and my research focuses on ${list(strengths)}` : ''}. ` +
      `${topics.length ? `The project's focus on ${list(topics)} matches my experience closely, and I would be excited to contribute to it.` : '[One sentence on why this project interests you.]'}`);
    if (a.evidence.length) {
      paras.push(`My background is directly relevant to this position:\n${a.evidence.map(e => `• ${e.line.replace(/^[•\-–*\d.)\s]+/, '')}`).join('\n')}\n[Rewrite these points in your own words: what you did, the result, and why it matters for this project.]`);
    } else {
      paras.push('[Two or three sentences on your most relevant experience for this call: projects, publications, methods or tools, with concrete results.]');
    }
    paras.push(`In this role, I would ${topics.length ? `bring my experience in ${list(topics.slice(0, 2))} to ` : ''}[describe concretely what you would contribute in the first year, e.g. a method, a dataset or tool, or a line of publications]. ` +
      `I enjoy working in collaborative, international teams, and I would welcome the opportunity to [mention supervision, teaching, collaborations or the group's specific strengths].`);
    paras.push(`Please find enclosed ${list(encloses(p))}. I would be glad to discuss my application at an interview at your convenience. Thank you for your time and consideration.`);
    paras.push(`Yours sincerely,\n\n${me.name || '[Your name]'}`);
    return { text: paras.join('\n\n'), analysis: a };
  }

  function prepNotes(p, a) {
    const lines = [];
    lines.push({ h: 'Preparation notes (delete this page before sending)' });
    lines.push(`Position: ${p.title}${p.institution ? ` — ${p.institution}` : ''}`);
    lines.push(`Deadline: ${p.deadline ? C.fmtDeadline(p) + C.timeLeft(p) : 'not stated: check the call'}${p.deadline && !p.deadlineTime ? ' (no time stated: check whether the call gives one, e.g. 13:00)' : ''}`);
    const how = [p.applyEmail && `email to ${p.applyEmail}${p.emailSubject ? ` (subject: "${p.emailSubject}")` : ''}`, p.applyUrl && `online at ${p.applyUrl}`].filter(Boolean);
    lines.push(`How to submit: ${how.length ? how.join('; or ') : 'see the call'}${p.callUrl ? `\nCall: ${p.callUrl}` : ''}`);
    lines.push({ h: 'Documents to prepare' });
    const docs = p.docs || [];
    if (docs.length) docs.forEach(d => lines.push(`${d.done ? '☑' : '☐'} ${d.name}`));
    else lines.push('☐ [No list yet: use “Check the call” in Scholarly]');
    lines.push({ h: 'Your topics that match the call' });
    lines.push(a.matched.length ? a.matched.map(topicCase).join(', ') : '[none recognised: add the call text in Scholarly for a better match]');
    if (a.gaps.length) {
      lines.push({ h: 'Call topics not in your CV (consider addressing them)' });
      lines.push(a.gaps.map(topicCase).join(', '));
    }
    const notes = (p.notes || '').split('\n').filter(l => /^• /.test(l));
    if (notes.length) { lines.push({ h: 'Watch out' }); notes.forEach(n => lines.push(n)); }
    return lines;
  }

  // ---------------- .docx writer (a zip with three XML parts, no library) ----------------
  const xmlEsc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function runs(text, { bold = false, size } = {}) {
    return text.split(/(\[[^\]\n]+\])/).filter(Boolean).map(part => {
      const ph = /^\[.*\]$/.test(part);
      const rpr = `<w:rPr>${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}${ph ? '<w:highlight w:val="yellow"/>' : ''}</w:rPr>`;
      return part.split('\n').map((seg, i) => `<w:r>${rpr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(seg)}</w:t></w:r>`).join('');
    }).join('');
  }

  function para(text, { bold, size, bullet, pageBreak, after } = {}) {
    const ppr = `<w:pPr>${pageBreak ? '<w:pageBreakBefore/>' : ''}${bullet ? '<w:ind w:left="360" w:hanging="240"/>' : ''}${after !== undefined ? `<w:spacing w:after="${after}"/>` : ''}</w:pPr>`;
    return `<w:p>${ppr}${runs(text, { bold, size })}</w:p>`;
  }

  function letterXml(letterText, notes) {
    const body = [];
    for (const block of letterText.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      if (lines.some(l => /^\s*[•\-–*]\s/.test(l))) {
        let buf = [];
        const flush = () => { if (buf.length) body.push(para(buf.join('\n'), { after: 60 })); buf = []; };
        lines.forEach(l => {
          if (/^\s*[•\-–*]\s/.test(l)) { flush(); body.push(para('• ' + l.replace(/^\s*[•\-–*]\s+/, ''), { bullet: true, after: 60 })); }
          else buf.push(l);
        });
        flush();
        body[body.length - 1] = body[body.length - 1].replace('<w:spacing w:after="60"/>', '');
      } else {
        body.push(para(block.trim(), { bold: /^Subject:/.test(block) }));
      }
    }
    let first = true;
    for (const n of notes) {
      if (typeof n === 'object') { body.push(para(n.h, { bold: true, size: first ? 28 : 24, pageBreak: first, after: 80 })); first = false; }
      else body.push(para(n, { after: 60 }));
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1304" w:bottom="1304" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>' +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="180" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

  function docxBlob(documentXml) {
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/document.xml', documentXml],
      ['word/styles.xml', STYLES],
    ];
    return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // Uncompressed ("stored") zip archive
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameB = enc.encode(name), data = enc.encode(content), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nameB, data);
      central.push(new Uint8Array(cen.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const cenSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
  }

  // ---------------- letter dialog ----------------
  let letterFor = null;
  let lastAnalysis = null;

  function me() {
    return { name: $('#lt-name').value.trim(), email: $('#lt-email').value.trim(), phone: $('#lt-phone').value.trim(), role: $('#lt-role').value.trim() };
  }

  function showLetter({ rebuild = false } = {}) {
    const p = C.get(letterFor);
    const personal = M() && M().get();
    const hasCV = !!(personal && personal.cvText);
    $('#letter-cv').hidden = hasCV;
    $('#letter-main').hidden = !hasCV;
    $('#letter-download').disabled = !hasCV;
    $('#letter-copy').disabled = !hasCV;
    $('#letter-regen').disabled = !hasCV;
    $('#letter-for').textContent = p ? `For: ${p.title}${p.institution ? ` — ${p.institution}` : ''}` : '';
    if (!p || !hasCV) return;
    const saved = personal.letter || {};
    const guess = guessMe(personal.cvText);
    $('#lt-name').value = saved.name || guess.name;
    $('#lt-email').value = saved.email || guess.email;
    $('#lt-phone').value = saved.phone || guess.phone;
    $('#lt-role').value = saved.role || guess.role;
    $('#letter-me').open = !(saved.name || guess.name) || !(saved.role || guess.role);
    const draft = p.letterDraft && !rebuild ? { text: p.letterDraft, analysis: analyse(p, personal) } : buildLetter(p, personal, me());
    lastAnalysis = draft.analysis;
    $('#letter-text').value = draft.text;
    const a = draft.analysis;
    $('#letter-insights').innerHTML = `
      <div><strong>Your topics that match the call:</strong> ${a.matched.length ? a.matched.map(t => `<span class="chip kw">${esc(topicCase(t))}</span>`).join(' ') : '<span class="muted">none recognised. Use “🔍 Check the call” in the position to paste the call text for a better letter.</span>'}</div>
      ${a.gaps.length ? `<div><strong>Call topics not in your CV:</strong> ${a.gaps.map(t => `<span class="chip">${esc(topicCase(t))}</span>`).join(' ')}</div>` : ''}
      ${p.letterDraft && !rebuild ? '<div class="muted">Showing your saved draft. “Rebuild draft” starts again from the call and your CV.</div>' : ''}`;
  }

  function openLetter() {
    letterFor = detailId;
    $('#letter-cv-status').textContent = '';
    $('#letter-dialog').showModal();
    showLetter();
  }

  function saveMe() {
    const m = me();
    const personal = M() && M().get();
    if (personal && JSON.stringify(personal.letter || {}) !== JSON.stringify(m)) M().patch({ letter: m });
  }

  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const text = $('#letter-text').value;
      const p = C.get(letterFor);
      if (p && p.letterDraft !== text) C.update(letterFor, x => { x.letterDraft = text; });
    }, 800);
  }

  function filename(p) {
    const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return `Cover-letter_${slug(p.institution) || 'position'}_${slug(p.title)}.docx`.replace(/_+\./, '.');
  }

  $('#letter-download').addEventListener('click', () => {
    const p = C.get(letterFor);
    if (!p) return;
    saveMe();
    const blob = docxBlob(letterXml($('#letter-text').value, prepNotes(p, lastAnalysis || analyse(p, M().get()))));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename(p);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    C.update(p.id, x => {
      x.letterDraft = $('#letter-text').value;
      const cl = (x.docs || []).find(d => /cover|motivation/i.test(d.name));
      if (!cl) (x.docs = x.docs || []).push({ name: 'Cover letter', done: false });
    });
    C.toast('Cover letter downloaded. Open it in Word or Google Docs to finish it.');
  });

  $('#letter-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText($('#letter-text').value).then(() => C.toast('Letter copied'));
  });

  $('#letter-regen').addEventListener('click', () => {
    if (C.get(letterFor)?.letterDraft && !confirm('Rebuild the draft? Your edits in this box will be replaced.')) return;
    saveMe();
    C.update(letterFor, x => { delete x.letterDraft; });
    showLetter({ rebuild: true });
  });

  $('#letter-text').addEventListener('input', saveDraft);
  ['#lt-name', '#lt-email', '#lt-phone', '#lt-role'].forEach(sel => $(sel).addEventListener('change', saveMe));

  $('#letter-cv-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('#letter-cv-status').textContent = `Reading ${file.name}…`;
    try {
      await M().importCV(file);
      $('#letter-cv-status').textContent = '';
      showLetter({ rebuild: true });
    } catch (err) {
      $('#letter-cv-status').textContent = err.message;
    }
  });

  // ---------------- wiring ----------------
  $('#btn-letter').addEventListener('click', openLetter);
  $('#detail-body').addEventListener('click', e => {
    if (e.target.closest('#btn-check-docs')) openDocsCheck();
  });
  $('#docs-run').addEventListener('click', () => runCheck());
  $('#docs-result').addEventListener('click', e => {
    const use = e.target.dataset.useDeadline;
    if (use) {
      const [date, time] = use.split('|');
      C.update(detailId, x => { x.deadline = date; x.deadlineTime = time; delete x.keepExpired; });
      e.target.closest('p').textContent = `Deadline updated to ${C.fmtDeadline(C.get(detailId))}.`;
      return;
    }
    const name = e.target.dataset.addDoc;
    if (!name) return;
    C.update(detailId, x => { (x.docs = x.docs || []).push({ name, done: false }); });
    e.target.remove();
    C.toast(`Added “${name}”`);
  });

  // for tests
  window.CareerlyLetter = { analyseCall, findDeadline, buildLetter, guessMe, docxBlob, letterXml, prepNotes };
})();
