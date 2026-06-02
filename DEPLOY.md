# Deploy to Vercel + Supabase — Step by Step

## Overview
This sets up your app with:
- **Supabase** — cloud database (your data lives here, safe forever)
- **GitHub** — stores your app code
- **Vercel** — serves the app as a live URL

Total time: ~25 minutes. Zero coding required.

---

## PART 1 — Set up the database (Supabase) — 10 minutes

### Step 1 — You already have a Supabase account ✓
Your project is at: **https://yyriktrovfiggvqvjhat.supabase.co**

### Step 2 — Create the database tables

1. Open your Supabase project dashboard
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `schema.sql` from this folder
5. Copy the entire contents and paste it into the SQL editor
6. Click **Run** (green button)
7. You should see: `Database setup complete ✓`

That's it — your database is ready.

### Step 3 — Allow your app URL (after deploying)

After deploying to Vercel (Part 2), you'll need to add your URL to Supabase:

1. In Supabase → **Authentication → URL Configuration**
2. Add your Vercel URL to **Site URL** (e.g. `https://bartender-app.vercel.app`)
3. Also add it to **Redirect URLs**
4. Click **Save**

---

## PART 2 — Deploy the app — 15 minutes

# Deploy to Vercel — Step by Step Guide

## What you're deploying
A web app that works like a native iPhone app — installable from Safari, works offline, camera access for scanning receipts.

---

## STEP 1 — Create a GitHub account (if you don't have one)

1. Go to **github.com**
2. Click **Sign up**
3. Use any email — doesn't need to be fancy
4. Verify your email

---

## STEP 2 — Create a new GitHub repository

1. Click the **+** icon top-right → **New repository**
2. Name it: `bartender-app`
3. Set to **Private** (keeps your tool to yourself)
4. Check **Add a README file**
5. Click **Create repository**

---

## STEP 3 — Upload the app files

In your new repository, click **Add file → Upload files**

Upload ALL of these files from the `bartender-app` folder:
- `index.html` ← the main tool
- `manifest.json`
- `sw.js`
- `vercel.json`
- `icon-192.png`
- `icon-512.png`

Click **Commit changes**

---

## STEP 4 — Create a Vercel account

1. Go to **vercel.com**
2. Click **Sign up** → **Continue with GitHub**
3. Authorize Vercel to access your GitHub

---

## STEP 5 — Deploy

1. In Vercel dashboard, click **Add New → Project**
2. Find `bartender-app` in your repository list → click **Import**
3. Leave all settings as default
4. Click **Deploy**

Vercel builds and deploys in about 30 seconds.

5. You'll get a URL like: `https://bartender-app-abc123.vercel.app`

That's your live app. Bookmark it.

---

## STEP 6 — Set a custom domain (optional but nicer)

In Vercel → your project → **Settings → Domains**

You can add a free subdomain like `bar.yourname.vercel.app`, or buy a domain like `antoinebar.app` for ~$10/year.

---

## STEP 7 — Install on iPhone

1. Open **Safari** on his iPhone (must be Safari, not Chrome)
2. Go to your Vercel URL
3. Tap the **Share button** (box with arrow pointing up)
4. Scroll down → tap **Add to Home Screen**
5. Name it "Bar Planner" → tap **Add**

It now appears on his home screen like a real app. Opens full screen, no browser bars.

---

## STEP 8 — Transfer your existing data

His recipes, inventory, and price history are in the browser's localStorage on his laptop. To move them to the new app:

1. Open the **old HTML file** on his laptop
2. Click **💾 All data** → save the backup file
3. Open the **new Vercel URL** in the laptop browser
4. Click **📂 Restore** → pick the backup file
5. All data transfers instantly

On his iPhone, the app will start fresh — import the same backup file there too.

---

## Updating the app

Whenever there's a new version of the tool:

1. Download the new `bartender_event_tool.html`
2. Rename it to `index.html`
3. Go to your GitHub repository
4. Click on `index.html` → click the pencil icon (edit)
5. Or drag-drop the new file to replace it
6. Click **Commit changes**

Vercel automatically redeploys in ~30 seconds. The app updates on his iPhone next time he opens it — **his data is never touched**.

---

## Why this is better than the file

| | HTML file | Vercel app |
|---|---|---|
| Works on iPhone | ✓ clunky | ✓ smooth |
| Home screen icon | ✗ | ✓ |
| Full screen (no browser bars) | ✗ | ✓ |
| Camera for scanning | file picker only | direct camera |
| Works offline | ✗ | ✓ |
| Survives iOS storage clear | ✗ | better |
| Update process | replace file | commit to GitHub |
| Cost | free | free |

---

## Troubleshooting

**"Add to Home Screen" doesn't appear**
→ Must use Safari, not Chrome or Firefox. iOS only allows PWA install from Safari.

**App shows old version after update**
→ Close the app fully (swipe up from home screen), reopen. Or go to Settings → Safari → Advanced → Website Data → delete the app data, then reopen.

**Data disappeared on iPhone**
→ iOS can clear PWA data if storage is very low. This is why the monthly All Data export is critical. Restore from your backup.

**Scans aren't working**
→ First scan: iOS will ask for camera permission. Tap Allow. If you accidentally denied it: Settings → Safari → Camera → Allow.
