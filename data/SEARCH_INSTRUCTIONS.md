# Daily position search: instructions for Claude

Each morning a scheduled Claude session follows these steps to fill the "New positions found for you"
inbox in the Careerly app.

1. Read `data/profile.md` (the candidate profile) and `data/suggestions.json` (what is already listed).
2. Search the web for **currently open** calls in Europe that match the profile. Run at least 10 varied
   searches, mixing core keywords with position types and sources, for example:
   - EURAXESS (euraxess.ec.europa.eu/jobs), AcademicPositions.eu, jobs.ac.uk, ELLIS (ellis.eu/jobs),
     Nature Careers, university career pages, MSCA Postdoctoral Fellowship hosting offers,
     Italian "assegno di ricerca" / RTD-A calls, CNR, Max Planck, Inria, ETH/EPFL, KU Leuven, TU Delft, etc.
   - Example queries: "postdoc large language models 2026 Europe", "postdoc data quality machine learning",
     "postdoc sentence embeddings NLP", "research fellow trustworthy AI data", "postdoc entity resolution",
     "postdoc graph neural networks fairness", "assegno di ricerca LLM", "MSCA postdoctoral fellowship host
     machine learning data management".
3. For each candidate call, open the call page and extract the real details. **Never invent details.**
   Leave a field as "" when the call does not state it.
4. Keep only calls that: are open (deadline today or later, or not stated but posted recently),
   match the profile (core keywords weigh most), and respect the "Exclude" list.
5. Skip calls already in `data/suggestions.json` (same `id` or same `callUrl`).
6. Append new items to the `suggestions` array, set `updatedAt` to the current ISO timestamp, and remove
   items whose deadline passed more than 7 days ago. Keep the file as valid JSON.
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
  "matchScore": 1-5,
  "why": "One or two sentences on why it matches the candidate's profile"
}
```
