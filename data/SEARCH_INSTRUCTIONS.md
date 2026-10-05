# Daily position search: instructions for Claude

Each morning a scheduled Claude session follows these steps to add "⭐ Claude pick" entries to the
"All open positions" list in the Careerly app.

1. Read the candidate's **CV (`data/cv.md`) and search profile (`data/profile.md`)**. The owner edits both from
   the app's "My profile & CV" button. The CV wins for skills and topics; the profile wins for preferences
   (countries, position types, exclusions). If `data/cv.md` is missing or empty, use the profile alone.
   Also read `data/SOURCES.md` (all websites to search) and `data/suggestions.json` (what is already listed).
2. Search the web for **currently open** calls that match the profile. The full list of websites is in
   [`SOURCES.md`](SOURCES.md). On every run: search **every ★ source** in SOURCES.md, plus that weekday's rotation
   groups. Make sure groups A–C below always get at least 4 queries each. Aim for **40+ queries in total**. When a source's pages can't be
   opened (network policy), use WebSearch with `allowed_domains` set to that site. That still returns its listings.

   **A. Italy: Bandi MUR (bandi.mur.gov.it).** Required every day. Use `allowed_domains: ["bandi.mur.gov.it"]`
   and Italian + English terms. The site has separate sections; cover all of them:
   - Incarichi post-doc (`incarichipostdoc.php`), the main Italian postdoc contract
   - Contratti / Incarichi di ricerca (`incarichidiricerca.php`)
   - Assegni di ricerca (`bandi.php`), older-type calls still published
   - Ricercatori a tempo determinato, RTD / RTT (`jobs.php`)
   Example queries: "incarico post-doc intelligenza artificiale", "incarico post doc machine learning",
   "contratto di ricerca large language models", "assegno di ricerca deep learning", "data quality imputazione dati",
   "elaborazione del linguaggio naturale", "sistemi di elaborazione delle informazioni IINF-05/A",
   "ricercatore a tempo determinato informatica INFO-01/A", "entity resolution", "basi di dati machine learning".
   Also run 1–2 open-web searches for Italian calls published on university sites (e.g. "bando incarico post-doc
   LLM 2026 università", plus CNR / FBK / IIT calls).

   **B. Other EU countries: EURAXESS (euraxess.ec.europa.eu/jobs).** Required every day. Use
   `allowed_domains: ["euraxess.ec.europa.eu"]`. Examples: "postdoc large language models", "postdoc machine
   learning data quality", "researcher natural language processing embeddings", "postdoc trustworthy AI",
   "postdoc graph neural networks", "MSCA postdoctoral fellowship hosting machine learning". Add 2–3 open-web
   searches on ELLIS (ellis.eu/jobs), AcademicPositions and Nature Careers.

   **C. UK and Ireland.** Required every day.
   - UK: `allowed_domains: ["jobs.ac.uk"]` (e.g. "research associate machine learning", "research fellow
     large language models", "research associate natural language processing"); also FindAPostDoc.
   - Ireland: Insight Centre (insight-centre.org), ADAPT Centre (adaptcentre.ie), Research Ireland
     (researchireland.ie), IrishJobs academic listings, and the job pages of TCD, UCD, UCC, University of Galway,
     DCU, TU Dublin and Maynooth (e.g. "postdoctoral researcher machine learning Ireland",
     "research fellow NLP Dublin").

   **D. Other non-EU Europe.** Switzerland (ETH/EPFL, Empa, IDSIA), Norway (jobbnorge.no), Iceland:
   2–3 queries.

   Record the source in each item's `source` field (e.g. "Bandi MUR", "EURAXESS", "jobs.ac.uk", "Insight Centre").
   For Bandi MUR items, put the MUR call link in `callUrl` and the university's own application page (often PICA,
   pica.cineca.it) in `applyUrl` when known.

3. For each candidate call, open the call page if the network allows it and extract the real details. **Never invent details.**
   Leave a field as "" when the call does not state it. In particular:
   - **Deadline time:** if the call states a closing time (e.g. "ore 13:00", "12:00 noon CET", "23:59 Brussels time"),
     put it in `deadlineTime` as 24-hour `HH:MM` and the time zone in `deadlineTz` (IANA name, e.g. `Europe/Rome`).
     The app removes a call the moment it closes; without a time it stays until the end of the deadline day.
   - **Documents:** list every document the call asks for in `documents` (e.g. "CV", "Cover letter",
     "Research proposal (max 3 pages)", "Reference letters (2)", "PhD certificate", "Publication list",
     "ID / passport copy", "Self-declaration (DSAN)"), and special requirements (PEC, signatures, a single PDF)
     in `procedure`.
4. Keep only calls that: are open (deadline today or later, or not stated but posted recently),
   match the profile (core keywords weigh most), and respect the "Exclude" list.
5. Skip calls already in `data/suggestions.json` (same `id` or same `callUrl`).
6. Append new items to the `suggestions` array, set `updatedAt` to the current ISO timestamp, and remove
   items whose deadline has passed (date and, if given, time). Keep the file as valid JSON.
7. Commit with a message like `Daily search: N new positions (YYYY-MM-DD)` and push to `main`.
   If nothing new was found, still update `updatedAt` and push, so the app shows the search ran.

## Item format

```json
{
  "id": "short-stable-slug, e.g. kuleuven-postdoc-llm-data-quality-2026",
  "foundOn": "YYYY-MM-DD (Europe/Rome date of this search)",
  "title": "Postdoctoral Researcher in ...",
  "type": "Postdoc | Researcher / Research Scientist | Research Fellow | MSCA Postdoctoral Fellowship | Junior Group Leader | Research Engineer | Other",
  "institution": "",
  "group": "",
  "pi": "",
  "country": "English country name, e.g. Germany",
  "city": "",
  "callUrl": "https://... (the page describing the call)",
  "reference": "",
  "deadline": "YYYY-MM-DD or empty",
  "deadlineTime": "HH:MM (24h) if the call states a closing time, else empty",
  "deadlineTz": "IANA time zone of that time, e.g. Europe/Rome, else empty",
  "startDate": "",
  "duration": "",
  "salary": "",
  "method": "email | portal | both | other",
  "applyEmail": "",
  "applyUrl": "",
  "emailSubject": "",
  "procedure": "Short summary of how to apply, as stated in the call",
  "documents": ["CV", "Cover letter", "..."],
  "keywords": "comma-separated topics of the position",
  "source": "Bandi MUR | EURAXESS | jobs.ac.uk | ...",
  "matchScore": 1-5,
  "why": "One or two sentences on why it matches the candidate's profile"
}
```
