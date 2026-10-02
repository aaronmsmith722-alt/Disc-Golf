# Disc Golf Bag Planner & Score Tracker

A mobile-first web app for planning which discs to bring to a course, scoring a
round hole by hole, and reviewing scoring stats over time. Data lives in a
Supabase (Postgres) database.

## Features

| Tab | What it does |
|---|---|
| **Plan** | Search 99 Utah courses. A course page shows average, shortest and longest hole distances, a hole-by-hole distance profile, and your course notes. Pick discs (or tap **Suggest** / **Copy last bag**) and start a round. |
| **Play** | Score hole by hole with big +/− buttons. Shows a running total and score to par. Each hole saves as you go, so a round survives closing the browser. Tap any hole number to fix a score. |
| **Stats** | Rounds played, average score to par, best round, birdie / par / bogey rates, a trend chart, per-course averages, and every round's scorecard. Filter by course. |
| **Bag** | Your discs with flight numbers (speed / glide / turn / fade). Add or remove discs. |

## Running it

It's a static site with no build step: `index.html`, `styles.css`, `app.js` and
`config.js`. Serve the folder with any web server, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk won't work, because browsers block
JavaScript modules on `file://` URLs.

It's published with GitHub Pages at
https://aaronmsmith722-alt.github.io/Disc-Golf/. On a phone, use the browser's
**Add to Home Screen** option to install it with its own icon; it then opens
full-screen like an app.

## Database

Six tables, as described in the Phase 2 writeup: `courses`, `holes`, `rounds`,
`hole_scores`, `discs` and `round_discs`.

Added since the writeup:

- `courses.holes_count`: the listed number of holes, for courses that don't
  have hole-by-hole data yet.
- `discs.glide`, `discs.turn`, `discs.fade`: the rest of each disc's flight
  numbers.

The app reads its stats from four views defined in
[`supabase/views.sql`](supabase/views.sql). They calculate everything from
`hole_scores` and `holes` when queried, so no totals are stored.

Row Level Security is on for every table, with policies that let anyone read
and write. There's no login, so anyone with the site can change the data.
