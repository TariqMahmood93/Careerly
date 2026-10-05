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

## 🔎 All open positions

Every morning a GitHub Actions job ([`scripts/fetch_positions.py`](scripts/fetch_positions.py)) collects **every open call** from:
- **Bandi MUR**: all *incarichi post-doc*, *incarichi di ricerca* and RTD/RTT posts, in all subjects (about 600 at a time).
- **EURAXESS**: new offers in computer science, data, engineering and related fields, read one by one and accumulated over time.
- **jobs.ac.uk**: research jobs matching ML, AI and data keywords.

It scores each one against your topics. In the app, **All open positions** shows the matches by default. Untick *Only matching my profile* to see everything, and filter by country, source and type.

### 🎯 Match to your own CV (for anyone with the link)

In **All open positions**, click **Match to my CV** and pick a PDF. The site reads the CV in your browser and picks out
your research topics, giving rarer topics more weight. It then ranks every open position for you. You can remove topics
or add your own. The CV and topics are stored only in that browser and never uploaded. Bandi MUR covers all subjects.
The EURAXESS and jobs.ac.uk listings currently focus on computer science, data, AI and engineering.

## 🆕 Daily position search

Every morning (06:00, Rome time) a scheduled Claude task searches the web for new postdoc and researcher
calls that match the profile in [`data/profile.md`](data/profile.md). It checks **Bandi MUR** (Italy), **EURAXESS** (other EU countries), **jobs.ac.uk** and Irish research centres and universities (UK and Ireland), plus Switzerland and Norway. The full catalogue of about 120 job boards, institutes and fellowship programmes is in [`data/SOURCES.md`](data/SOURCES.md). It covers ★ sources daily and rotates through the others by weekday. It adds them to
[`data/suggestions.json`](data/suggestions.json) on `main`. In the app they appear in **All open positions**
marked **⭐ Claude pick**, with a short note on why each one matches. Pick *Claude daily pick* in the source filter to
see only those. Use **+ Track** to add one to your applications.

- Click **👤 My profile & CV** in the app to upload your CV (PDF) and edit what it looks for. They're saved as
  [`data/cv.md`](data/cv.md) and [`data/profile.md`](data/profile.md), which anyone can view. To save, paste a
  GitHub token once per device; the app shows the steps.
- The inbox only works when the app is online (GitHub Pages, see below). It doesn't show when you open `index.html` as a local file.
- Always check the original call before applying. Details are collected automatically and can be incomplete.

## Helpful extras

- **Dashboard**: counts per status. Click a tile to filter.
- **Alerts**: deadlines in the next 7 days, deadlines passed while still "to apply", and applications with no news for 60+ days (time to follow up or mark them "No response").
- **Search, filter and sort** by status, country, position type, deadline or date applied.
- **Quick status change** from each card.
- **One-click email**: the application email opens your mail client with the required subject line already filled in.
- **Backup**: export or import a `.json` backup, and export a `.csv` to open in Excel or Google Sheets.

## 🔐 Accounts: your tracker on every device

Click **🔐 Log in** and then **Create account**, using your email and a password. Once signed in, your tracked positions and
your *Match to my CV* profile are saved in your account, a private Supabase database where each user can see only
their own data. Log in on any laptop, phone or incognito window to see them. Anything you tracked before signing up
is added to your account. Logging out clears this browser's copy, but your data stays safe in your account.

Without an account the app works as before, storing everything in this browser only.

## ⚠️ About your data (without an account)

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
