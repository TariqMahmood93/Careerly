# Careerly

A simple, private tracker for **postdoc, researcher and fellowship applications** across EU / European countries.
Keep every call in one place: where it is, how to apply, what documents it needs, the deadline and where your application stands.

No account, no server, no build step: it's a single static web page, and your data stays in your browser.

## What you can store for each position

| Section | Fields |
|---|---|
| **The position** | Title, type (Postdoc, Researcher, MSCA, Fellow…), call/reference ID, institution, department/group, PI, keywords, country, city, link to the call |
| **Key dates & conditions** | Deadline, start date, contract duration, salary/funding |
| **How to apply** | Method (email / online portal / both / other), email address to send to, required email subject, portal URL, portal account (no passwords!), the full procedure text copied from the call, and a **checklist of required documents** (CV, cover letter, research statement, references…) |
| **Contact person** | Name, email |
| **Status** | Saved/to apply · Preparing · Applied · Under review · Interview · Offer/accepted · Rejected · No response · Withdrawn/declined · Deadline missed. Also date applied, last follow-up, interview date, priority, notes |

Every status change is logged with a date, so each position shows its own timeline.

## 🆕 Daily position search

Every morning (06:00, Rome time) a scheduled Claude task searches the web for new postdoc and researcher
calls that match the profile in [`data/profile.md`](data/profile.md). It checks **Bandi MUR** (Italy), **EURAXESS** (other EU countries), **jobs.ac.uk** and Irish research centres and universities (UK and Ireland), plus Switzerland and Norway. The full catalogue of about 120 job boards, institutes and fellowship programmes is in [`data/SOURCES.md`](data/SOURCES.md). It covers ★ sources daily and rotates through the others by weekday. It adds them to
[`data/suggestions.json`](data/suggestions.json) on `main`. When you open the app, they appear at the top under
**New positions found for you**, where you can **+ Add to tracker** or **Dismiss** each one.

- Edit `data/profile.md` to change what it looks for. The search steps are in
  [`data/SEARCH_INSTRUCTIONS.md`](data/SEARCH_INSTRUCTIONS.md).
- The inbox only works when the app is online (GitHub Pages, see below). It doesn't show when you open `index.html` as a local file.
- Always check the original call before applying. Details are collected automatically and can be incomplete.

## Helpful extras

- **Dashboard**: counts per status. Click a tile to filter.
- **Alerts**: deadlines in the next 7 days, deadlines passed while still "to apply", and applications with no news for 60+ days (time to follow up or mark them "No response").
- **Search, filter and sort** by status, country, position type, deadline or date applied.
- **Quick status change** from each card.
- **One-click email**: the application email opens your mail client with the required subject line already filled in.
- **Backup**: export or import a `.json` backup, and export a `.csv` to open in Excel or Google Sheets.

## ⚠️ About your data

Everything is saved in your browser's local storage, on your own device only. That means:

- Clearing browser data, or using a different browser or computer, will **not** show your entries.
- Use **Backup → Export backup (.json)** regularly. The app reminds you every 14 days.
  Keep the file somewhere safe (Google Drive, Dropbox, email it to yourself).
- To move to another computer, export there and **import** the file on the new one. Imports merge and never delete existing entries.

## How to use it

**Option 1: open locally.** Download or clone the repo and double-click `index.html`.

**Option 2: put it online for free with GitHub Pages** (use it from any device):

1. Merge this code into the `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The included workflow deploys the site. It will be at `https://<your-username>.github.io/Careerly/`.

Note: each browser or device still keeps its own data. Use export/import to sync between them.

## Files

- `index.html`: page layout and forms
- `styles.css`: styling (light and dark mode, mobile friendly)
- `app.js`: all the logic (storage, alerts, filters, backup)
