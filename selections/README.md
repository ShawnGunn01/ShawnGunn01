# Raw Development Design: New Build Selections Checklist

A client-facing, room-by-room selections checklist with a small backend so that
every client's answers save to Raw Development instead of to the client's
device. It is the same checklist as the shared page (28 pages, repeatable
bathroom, bedroom and interior-door tabs, open items, sign-off with versions,
print and email), now hosted by you.

## What it does

**For the Raw Development team (builder)**

- Sign in with the builder password.
- Create a job per client. Each job is a saved record you can open from any
  phone or computer.
- Copy the client link for a job and send it to the client. "Make a new link"
  cuts off the old one.
- See every submission ("Send to builder") with the date, who sent it, how many
  items were still open, and the signed version.
- Open or print the summary, archive a job, delete a job.
- Start a job from a checklist that was filled in on your device offline.

**For the client**

- Opens the link on any device. No account or password.
- Every tap saves to the job record as they go. Two people can fill it in from
  two phones; the page refreshes itself every few seconds while nobody is typing.
- "Send to builder" records the submission on the job and, when email is set
  up, emails the full summary to the builder address with the summary attached
  as an HTML file.
- Sign-off with their name records a version; any later change marks the job
  "Unsigned changes" until they sign again.

**Without a link or sign-in** the page still works as an on-device checklist,
like the original.

## Run it

```
cd selections
npm install
BUILDER_PASSWORD=choose-a-password npm start
```

Open http://localhost:3000, click "Builder sign in", and create a job.

Tests:

```
npm test
```

## Settings

Copy `.env.example` and set these in your host's environment:

| Variable | What it does |
| --- | --- |
| `BUILDER_PASSWORD` | Required. Password for builder sign-in. |
| `BUILDER_EMAIL` | Where submissions are emailed. Default `Treese@rawdevelopment.com`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email delivery. For Google Workspace: host `smtp.gmail.com`, port 587, your address, and an app password. Without SMTP, submissions are still saved on the job and visible to the builder. |
| `SUBMIT_WEBHOOK_URL` | Optional. Each submission is also POSTed as JSON here (Zapier, Make, or a Google Apps Script that writes to your Sheet tracker). |
| `SELECTIONS_DATA_DIR` | Where `jobs.json` lives. On a host, point it at a persistent disk. |
| `PUBLIC_URL` | The app's public address, used for the "open the job" link in emails. |
| `PORT` | Defaults to 3000. |

## Deploying

Any Node host works (Render, Railway, Fly.io, a small VPS). Set the variables
above, make sure `SELECTIONS_DATA_DIR` is on a persistent disk, and put it
behind HTTPS so client links aren't sent in the clear.

## How the data is stored

One JSON file, `data/jobs.json`, holding every job and builder session. Each
job has:

- `data`: selections keyed by room scope, then `section/field`
- `reps`: the bathroom, bedroom and door tabs
- `signoffs`: signed versions with a hash of the selections at signing
- `submissions`: every "Send to builder"
- `token`: the client link secret

Patches from the browser merge field by field, so two people editing the same
job don't overwrite each other.

## Files

- `server.js`: Express API and static hosting
- `lib/store.js`: job records, builder sessions, patch merging
- `lib/mail.js`: submission delivery by email and webhook
- `public/checklist.js`: the checklist content (every room and item)
- `public/summary.js`: open items, sign-off status, summary text and HTML, shared by browser and server
- `public/app.js`: the browser app
- `test/`: API, mail and summary tests
