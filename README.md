# SocialEdge

**Automatically track, analyse, and grow your LinkedIn Social Selling Index score — every day, with zero manual work.**

SocialEdge is a Chrome extension built for LinkedIn Sales Navigator users who want full visibility into their SSI score, daily progress, and concrete actions to improve it. No spreadsheets, no copying cookies, no manual API calls — just open LinkedIn and your score is captured silently in the background.
---
## Table of Contents

1. [What is SSI?](#what-is-ssi)
2. [How SocialEdge Works](#how-socialedge-works)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [First-Time Setup](#first-time-setup)
6. [UI Overview](#ui-overview)
7. [Features in Detail](#features-in-detail)
8. [Activity Tracking](#activity-tracking)
9. [Score History](#score-history)
10. [Boost Strategy Plan](#boost-strategy-plan)
11. [Data & Privacy](#data--privacy)
12. [File Structure](#file-structure)
13. [Technical Architecture](#technical-architecture)
14. [Troubleshooting](#troubleshooting)

---

## What is SSI?

The **Social Selling Index (SSI)** is a LinkedIn metric (0–100) that measures how effectively you use LinkedIn for social selling. It is broken into four equally-weighted pillars, each scored 0–25:

| Pillar | What it measures |
|---|---|
| **Professional Brand** | How complete and active your profile is; thought leadership through content |
| **Find Right People** | How effectively you search and target the right prospects |
| **Insight Engagement** | How actively you share and engage with relevant content |
| **Strong Relationships** | How well you build and nurture relationships on the platform |

A higher SSI score correlates with more profile views, more InMail responses, and more pipeline. LinkedIn reports that top SSI performers create 45% more opportunities per quarter.

---

## How SocialEdge Works

SocialEdge never asks you to copy cookies, tokens, or headers manually. Instead it uses a **passive capture** approach:

1. When you browse any LinkedIn page, SocialEdge intercepts LinkedIn's own authenticated API request to `salesApiSsi` using the browser's `webRequest` API.
2. It saves the exact request headers from that live session.
3. When a score refresh is needed, it silently replays the same request from your open LinkedIn tab — using your browser's existing cookies — and stores the response.
4. All data stays local on your machine inside Chrome's `storage.local`. Nothing is sent to any external server.

---

## Requirements

- **Google Chrome** (version 116 or later, for Manifest V3 + Side Panel support)
- **LinkedIn account** with an active **Sales Navigator** subscription
- You must be **logged in to LinkedIn** in Chrome

---

## Installation

SocialEdge is loaded as an unpacked extension (developer mode). It does not require the Chrome Web Store.

### Step 1 — Download the extension

Clone or download this repository:

```bash
git clone https://github.com/artemrudman/socialedge.git
```

Or download the ZIP from GitHub and extract it anywhere on your computer.

### Step 2 — Open Chrome Extensions

Navigate to:

```
chrome://extensions
```

Or go to **Chrome menu (⋮) → Extensions → Manage Extensions**.

### Step 3 — Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer mode** ON.

### Step 4 — Load the extension

Click **Load unpacked** and select the `extension/` folder inside the repository (the folder that contains `manifest.json`).

SocialEdge will appear in your extensions list with the ascending-dots icon.

### Step 5 — Pin the extension (recommended)

Click the puzzle-piece icon in the Chrome toolbar, find **SocialEdge**, and click the pin icon so it stays visible in your toolbar.

---

## First-Time Setup

SocialEdge needs to capture one live SSI request before it can work autonomously.

1. After installing, **navigate to LinkedIn Sales Navigator** in any tab:
   ```
   https://www.linkedin.com/sales/ssi
   ```
2. LinkedIn's page will automatically call the SSI API. SocialEdge intercepts this silently.
3. Your score is captured and stored. The extension is now initialised.

From this point on, SocialEdge will refresh your score automatically every day when you open Chrome, or whenever you click **Refresh Score** in the panel.

> **You only need to visit Sales Navigator once.** After that, the extension refreshes silently in the background using your existing session.

---

## UI Overview

Click the SocialEdge icon in your Chrome toolbar to open the **Side Panel** — a persistent panel that slides in on the right side of your browser without disrupting the page you're reading.

```
┌─────────────────────────────────────┐
│  ⬡ SocialEdge          ↓ Free Plan │
│    LinkedIn Selling Score  Updated… │
├─────────────────────────────────────┤
│           46.3           ↑ +2.1     │
│     Overall SSI Score / 100         │
│  ████████████████░░░░░░░░░░░░░░░░  │
├──────────────┬──────────────────────┤
│ Professional │ 12.3  ↑ +0.4        │
│ Brand        │ ████████░░░░░░░░     │
├──────────────┼──────────────────────┤
│ Find Right   │  6.4  → —           │
│ People       │ █████░░░░░░░░░░░     │
├──────────────┼──────────────────────┤
│ Insight      │ 11.0  ↑ +1.2        │
│ Engagement   │ ████████████░░░░     │
├──────────────┼──────────────────────┤
│ Strong       │ 16.6  ↓ -0.3        │
│ Relationships│ █████████████████░░  │
├─────────────────────────────────────┤
│  Industry: Data Infrastructure…     │
│  Top 8%  •  26.9 SSI               │
│  Network  Top 14%  •  33.6 SSI     │
├─────────────────────────────────────┤
│  ↻ Refresh Score    Export JSON    │
├─────────────────────────────────────┤
│  🕐 Score History          30 ›    │
└─────────────────────────────────────┘
```

---

## Features in Detail

### Overall Score with Trend Arrow

The large number at the top is your current overall SSI (0–100). A coloured trend badge appears next to it:

- **↑ +2.1** in green — score increased since yesterday
- **↓ -1.4** in red — score decreased
- No badge — no change or no previous data

The progress bar below uses the same colour as the score rating:

| Colour | Score range | Meaning |
|---|---|---|
| 🟢 Green | ≥ 72 of max | Excellent |
| 🔵 Blue | ≥ 48 of max | Good |
| 🟡 Amber | ≥ 28 of max | Needs work |
| 🔴 Red | < 28 of max | Low |

### Four Pillar Cards

Each pillar shows:
- Its current score (0–25)
- A colour-coded progress bar
- A trend arrow and delta vs. yesterday (e.g. **↑ +0.4**)

**Clicking any pillar card** opens its detail screen.

### Pillar Detail Screen (slides in from right)

Tapping a pillar slides in a full detail view with:
- Large pillar score with colour and trend
- Animated progress bar
- **10 specific activities** for that pillar as checkboxes (see [Activity Tracking](#activity-tracking))

### Benchmark Comparisons

Below the pillars, two rows show how you rank:

- **Industry** — your SSI vs. others in your industry (e.g. "Data Infrastructure and Analytics"), shown as "Top N%" with a colour-coded rank badge
- **Network** — your SSI vs. your direct LinkedIn network

Rank badge colours:
- 🟢 Top 1–10% — Elite
- 🔵 Top 11–25% — Above average
- 🟡 Top 26–50% — Average
- 🔴 Top 51%+ — Below average

### Refresh Score Button

Manually triggers a silent score fetch. SocialEdge uses an already-open LinkedIn tab to replay the request — no new tab opens, no navigation happens. The score updates in the panel within seconds.

### Export JSON

Downloads your full 365-day score history as a structured JSON file named `socialedge_YYYY-MM-DD.json`. Available from both the main panel and the history screen.

### Auto-refresh on Browser Start

Every time Chrome starts, SocialEdge checks whether today's score has already been fetched. If not, it attempts a silent refresh automatically. If no LinkedIn tab is open yet, the refresh fires as soon as you open any LinkedIn page.

### Daily Alarm Fallback

A Chrome alarm fires every 24 hours as a secondary trigger for long Chrome sessions that stay open overnight.

---

## Activity Tracking

SocialEdge lets you log what LinkedIn actions you actually completed each day, directly inside the extension.

### How to log activities

1. **Click any pillar card** on the main screen.
2. The detail screen slides in with 10 relevant checkboxes for that pillar.
3. Check off everything you did today.
4. Click **Save Activities**.
5. A "✓ Saved for today" confirmation appears briefly.

Activities are stored locally per day. You can come back and update them any time during the day — saving overwrites the previous selection for that pillar.

### Activity lists

**Professional Brand (10 activities)**
- Published an original post
- Published a long-form article
- Updated a profile section
- Requested a skill endorsement
- Gave a skill endorsement to a connection
- Shared industry content with personal commentary
- Refreshed profile photo or banner
- Added a quantified achievement to experience
- Added or updated featured section
- Completed a LinkedIn learning course

**Find Right People (10 activities)**
- Used advanced search filters to find prospects
- Saved 5+ new leads
- Saved a new account
- Reviewed "People Also Viewed" suggestions
- Used TeamLink to find a warm introduction
- Browsed recommended accounts
- Ran a boolean search query
- Filtered by job change in the past 90 days
- Searched within a specific account
- Reviewed lead recommendations from Sales Navigator

**Insight Engagement (10 activities)**
- Left a thoughtful comment on a lead's post
- Shared content with personal insight added
- Engaged with a target account's content
- Created a poll
- Responded to a poll
- Sent a relevant article to a prospect
- Liked a post from a saved lead
- Reposted with added perspective
- Replied to a comment on my own post
- Tagged a connection in a relevant post

**Strong Relationships (10 activities)**
- Sent a personalized InMail
- Followed up with a new connection
- Congratulated a lead on a job change
- Congratulated a lead on a work anniversary
- Reconnected with a dormant contact
- Responded to a message within 24 hours
- Sent a voice note to a prospect
- Accepted a connection request with a personal reply
- Introduced two connections to each other
- Scheduled a call or meeting with a lead

---

## Score History

Click **Score History** at the bottom of the main panel. The history screen slides up from the bottom.

### History table columns

| Column | Description |
|---|---|
| **Date** | The date the score was captured |
| **Score** | Overall SSI score |
| **PB** | Professional Brand sub-score |
| **FRP** | Find Right People sub-score |
| **IE** | Insight Engagement sub-score |
| **RS** | Strong Relationships sub-score |
| **Act.** | Activity log indicator |

### Trend arrows in history

Every score cell compares to the previous row. A green ↑ or red ↓ appears next to the value when there's a meaningful change (≥ 0.05 points).

### Activity column (Act.)

If you logged any activities for a given day, a green **✓** badge appears in the Act. column.

**Clicking the ✓ badge** slides in an activity detail screen from the right, showing only the activities you actually completed that day, grouped by pillar. Empty items are hidden.

### Export

The **Export** button in the top-right of the history screen downloads your full history as JSON. The file includes raw API responses as well as parsed scores.

### Back navigation

- History screen: the **↑ Back** arrow in the top-left slides the screen back down
- Activity detail: the **← Back** arrow returns to the history table

---

## Boost Strategy Plan

A **Free Boost Strategy** download link appears in the top-right of the main header. Clicking it downloads `SocialEdge_Boost_Strategy.pdf` — a step-by-step guide for systematically improving each SSI pillar.

---

## Data & Privacy

- **All data is stored locally** in Chrome's `chrome.storage.local`. Nothing leaves your browser.
- SocialEdge **never creates a new LinkedIn tab** or navigates any existing tab. It only reads from and replays requests within tabs you already have open.
- **No external servers** are contacted. The extension has no backend.
- Stored data includes: your SSI scores (up to 365 days), the raw API responses, captured request headers (for replay), and your daily activity logs.
- To clear all data: go to `chrome://extensions` → SocialEdge → **Details** → **Clear site data**, or remove and reinstall the extension.

---

## File Structure

```
extension/
├── manifest.json          Chrome extension manifest (MV3)
├── background.js          Service worker: header capture, fetch replay, alarms, storage
├── content_main.js        Injected in MAIN world: patches window.fetch and XHR to intercept SSI responses
├── content.js             Injected in ISOLATED world: relays postMessage events to background
├── popup.html             Side panel UI markup
├── popup.css              Dark theme styles
├── popup.js               UI logic: rendering, activity tracking, navigation, export
├── icons/
│   └── icon.svg           Extension icon (ascending dots trend line)
└── Info Plan.pdf          Free Boost Strategy Plan (downloadable from UI)
```

---

## Technical Architecture

### Manifest V3 (MV3)

SocialEdge uses Chrome's Manifest V3, which means:
- The background script runs as a **service worker** (not a persistent background page)
- All network interception uses `webRequest` with `extraHeaders` for full header access
- The UI uses the **Side Panel API** (`chrome.sidePanel`) instead of a popup

### Header Capture Strategy

LinkedIn's `salesApiSsi` endpoint requires a valid `csrf-token` header that matches the active session. Rather than constructing this manually (which breaks when sessions rotate), SocialEdge intercepts LinkedIn's own outgoing request using `chrome.webRequest.onBeforeSendHeaders` and caches the exact headers used. These are then replayed verbatim via `chrome.scripting.executeScript` inside an existing LinkedIn tab, with `credentials: 'include'` so browser cookies are attached automatically.

### Dual Content Script Worlds

- **`content_main.js`** runs in the `MAIN` JavaScript world (`document_start`) so it can wrap `window.fetch` and `XMLHttpRequest.prototype` before LinkedIn's own scripts run. This allows it to intercept SSI responses that LinkedIn's own page fetches.
- **`content.js`** runs in the `ISOLATED` extension world and acts as a bridge, forwarding `postMessage` events from `content_main.js` to `background.js` via `chrome.runtime.sendMessage`.

### Storage Schema

```
chrome.storage.local:
├── ssiExactHeaders         { headers: {}, ts: timestamp }
├── ssiHistory              [ { date, parsed, raw }, ... ]   ← up to 365 entries
└── dailyActivities         { 'YYYY-MM-DD': { prof_brand: [bool×10], ... } }
```

### Automatic Updates

| Trigger | Behaviour |
|---|---|
| Browser start (`onStartup`) | Checks if today's score is missing; fires silent replay if a LinkedIn tab is open |
| Daily alarm | Fires every 1440 minutes as a fallback for long sessions |
| LinkedIn page load | `webRequest` fires whenever LinkedIn's own page calls `salesApiSsi`; score is captured automatically |
| Manual refresh | User clicks "Refresh Score"; replay fires immediately using cached headers |

---

## Troubleshooting

### "Visit LinkedIn Sales Navigator once to initialise SocialEdge"

The extension has no cached headers yet. Open `https://www.linkedin.com/sales/ssi` in any tab. LinkedIn will load the SSI dashboard and call the API automatically — SocialEdge will capture it.

### "Open a LinkedIn tab, then try again"

SocialEdge replays the request inside an existing LinkedIn tab. Open any `linkedin.com` page and click Refresh Score again.

### "Request timed out"

The replay request didn't return within 15 seconds. This can happen if:
- Your LinkedIn session has expired — log in again at `linkedin.com`
- Your Sales Navigator subscription has lapsed
- LinkedIn is temporarily throttling the endpoint — try again in a few minutes

### Score is stale / not updating automatically

If auto-capture via `webRequest` stopped working (e.g. after a browser update), visit `https://www.linkedin.com/sales/ssi` once to refresh the cached headers, then click Refresh Score.

### Export downloads an empty or broken file

Make sure you have at least one score entry captured. Click Refresh Score first, then try exporting again.

### Extension icon not visible

Click the puzzle-piece icon (🧩) in the Chrome toolbar → find SocialEdge → click the pin icon.

---

## License

Private / proprietary. All rights reserved.
