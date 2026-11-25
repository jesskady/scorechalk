# Score Chalk: working notes for Claude

scorechalk.com is a free scorekeeping web app (darts, cribbage, Yahtzee, Magic,
the Builder for any other game) on Cloudflare Workers. Static pages are in
`public/` and the Worker is in `worker/`. The README covers the layout, running
locally, tests, accounts and deploying; read the relevant section before
changing those areas.

## Every change

- **Bump `?v=` when a stylesheet or script changes.** Pages load `style.css?v=N`
  and `app.js?v=N`, and anything with `?v=` is cached for a year (the Worker
  and the service worker both assume this). A change without a bump never
  reaches returning visitors. HTML pages themselves aren't versioned.
- **Run `npm test` before deploying.** It's the whole suite, about 4 minutes,
  driving real browsers. When changing an interface, add or update a test the
  way the existing ones are written, as a person would use it.
- **Deploy with `npm run deploy`**, not `wrangler deploy`: it also tells
  IndexNow (Bing and others) which pages changed.
- **After changing a page, run `npm run sitemap`** and commit the sitemap. The
  list of pages is `scripts/pages.mjs`; a new public page goes there too.
- **Commit straight to `main`** is the norm here. Push and deploy only when the
  owner asks.

## How the site should behave

- **Two ways of doing the same thing get a choice screen.** When a game offers
  alternative interfaces (cribbage's Simple or Detailed play and Cards or
  Buttons count, the Builder's Sheet or Board), Start Game shows a "how do you
  want to…" screen with:
  - a real screenshot of each option
  - a line saying it can be switched during the game, and where
  - a small "Last time" tag on the previous choice

  No option looks selected before it's tapped: outline on mouse hover only
  (`@media (hover:hover)`). Screenshots come from `npm run previews`
  (`scripts/previews.mjs`); retake them when the pictured controls change.
  Tests get through these screens via `startGame` in `tests/helpers.mjs`.
- **Tournaments live inside their game.** A "Run a … tournament" bar sits on
  that game's setup screen; there is no Tournament card on the home page.
- **Live games offer the win, they don't declare it.** Reaching the target
  shows a bar with End game, so the hand can be finished or undone. Games
  taken in turns end when the round is played out.
- **Rooms.** Every game is played in one of three styles (Parlor, Living Room,
  Workshop; see `public/themes.css`). New UI uses the theme's colour tokens,
  and anything pictured per game should match its room.
- **"Score Chalk", two words**, everywhere people can read it.

## Style

- Comments explain why, in plain sentences, as the existing code does.
- Commit messages: a plain-English summary line, then a short paragraph on
  what changed and why. No prefixes like `feat:`.
- `qa/` holds reports from the scheduled agents (`.claude/agents/`): the weekly
  playtest and the SEO audit. They suggest; they don't change site code.
