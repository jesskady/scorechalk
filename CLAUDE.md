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
- **Pull before deploying.** Cloud sessions push to `main` and deploy with the
  Deploy workflow, so a laptop's `main` can be behind the live site, and
  deploying it would take their work off the site. Run `git pull --rebase`
  first, and deploy only from an up-to-date `main`.
- **Deploy with `npm run deploy`**, not `wrangler deploy`: it rebuilds the
  sitemap's dates from git first, and afterwards tells IndexNow (Bing and
  others) which pages changed. Commit before deploying (the dates come from
  commits), and commit `public/sitemap.xml` if the deploy says it changed.
  The list of pages is `scripts/pages.mjs`; a new public page goes there too.
  From a cloud session (no `wrangler login`, and its network breaks the
  asset upload), deploy by starting the **Deploy** GitHub Actions workflow
  on `main` instead: it runs the tests, `npm run deploy`, and commits the
  sitemap itself. Push `main` first.
- **A commit that only changes what every page shares** (the header, the
  badge, a `?v=` bump) ends its message with the line `Sitemap: chrome`, so
  it doesn't move every page's date in the sitemap or ping every page to
  IndexNow. Never on a commit that also changes a page's content.
- **After changing how a game or the home page looks, run `npm run store-shots`**
  and commit what it writes: the manifest's screenshots (Chrome's install
  dialog, app stores, PWA directories) and the shortcut icons.
- **Commit straight to `main`** is the norm here. Push and deploy only when the
  owner asks, and "deploy" means both: after `npm run deploy` (and its
  sitemap commit), push `main` to GitHub too, without asking. The scheduled
  agents read GitHub, so a deploy left unpushed has them checking old code
  against the new live site.
- **Run the full suite only before a deploy**, not after every small local
  change; check those in the browser on `npm run dev` instead.

## The work board

Everything to be done on the site is on the work board at `/admin/#work`
(`worker/work.js`). `SEO-###` items come from the SEO audit's ledger, and
`W-###` items are bugs, ideas and tasks added by hand. From a terminal,
`npm run work` reads and changes it on the live site. Its token is in
`.work-token` (gitignored); never print or commit it.

- **"Let's tackle SEO-012"** (or `W-003`): first `npm run work -- show SEO-012`
  for the detail, what the audit last saw, and the owner's notes. Then
  `npm run work -- doing SEO-012`.
- **Once it's live**, after the deploy that ships it and the push, run
  `npm run work -- done SEO-012 "Deployed in <short sha>: <what shipped>"`.
  Not before: Done means it's on the live site, and the audit will go and
  check. If only part of it shipped, leave it In progress and add a line with
  `npm run work -- note SEO-012 "…"`.
- **A bug or idea found along the way** that isn't being fixed now: add it with
  `npm run work -- add bug "title" "detail"`, and mention it to the owner.
- Statuses change on the board, never by editing `qa/seo/ledger.md`. That
  file belongs to the audit, which reads the board each run.

## What Score Chalk is

The best replacement for the pen-and-paper score sheet: easy scorekeeping,
especially for games whose scoring is a pain to track by hand (bids, bags,
doubling, running totals, checkouts). It isn't a rules engine or a game
platform. Copy leads with that convenience, in the positive ("easy
scorekeeping, even for the trickiest games"), not with what's wrong with
paper, and not with pubs or tabletops. The rooms (Parlor, Living Room,
Workshop) are the look, not the pitch.

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
- **One mark: the badge.** The wood-framed slate with a chalk five-bar gate
  (`public/favicon.svg`) is the app icon, the browser-tab icon, the home
  page logo (left of the name) and the way home on every other page: a
  chevron and the badge, top-left (`.backlink.mark` in `shared.css`), no
  words. A link that goes somewhere other than home (a tournament, Formats)
  stays a text link. Bump `favicon.svg?v=` if the badge changes.
- **"Score Chalk", two words**, everywhere people can read it.
- **Every game keeps its state the same way** (README, *How a game keeps its
  state*): what was done is the record, and scores are worked out from it;
  `names`, `cur`, `me`, `log`, `edits`; `save()` to the device and profile.
  Darts included: a change to games in general should need no special case
  for it, and a new game follows the same shape.

## Style

- Comments explain why, in plain sentences, as the existing code does.
- Commit messages: a plain-English summary line, then a short paragraph on
  what changed and why. No prefixes like `feat:`.
- `qa/` holds reports from the scheduled agents (`.claude/agents/`): the weekly
  playtest and the SEO audit. They suggest; they don't change site code.
