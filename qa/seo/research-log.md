# Score Chalk SEO research log

Topics, sources and queries per run, newest first. Use it to avoid repeating ground.

## 2026-11-22 (first run)

Live site and PageSpeed Insights were **not reachable** from the sandbox: scorechalk.com blocked by the session's network policy (curl 403 from the egress proxy, WebFetch DNS failure). PSI API returned 429 (daily quota on the keyless shared project). The audit is source-only.

Topics:
1. **Canonicals vs noindex for parameter URLs.** Query: "Google Search Central web app PWA SEO canonical query parameter noindex 2026". Sources: developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls; searchengineland.com/canonicalization-seo-448161. Takeaway: canonical is for duplicates, noindex is for pages that shouldn't be in the index. Don't mix them on one URL. This fed SEO-001 and SEO-002.
2. **IndexNow / Cloudflare Crawler Hints / Bing Webmaster.** Query: "IndexNow Cloudflare Crawler Hints Bing Webmaster Tools setup". Sources: developers.cloudflare.com/cache/about/crawler-hints/; blog.cloudflare.com/cloudflare-now-supports-indexnow/; bing.com/indexnow/getstarted. Takeaway: one-click, driven by cache misses. This fed SEO-005.
3. **Competitor scorekeeper apps and the games they target.** Query: "best score keeper app online card games … Rummy Phase 10 Hearts Spades". Sources: App Store listings for HD Score Keeper, Scotee, Card Score Keeper, Score Keeper for Five Crowns, ScoreApp, DeckScore. Takeaway: Spades, Hearts, Phase 10, Five Crowns and Rummy are the common headline games. This fed SEO-011 and SEO-012.
4. **Manifest screenshots / Richer Install UI.** Query: "web app manifest screenshots richer install UI Chrome form_factor". Sources: web.dev/articles/web-apps/richer-install-ui; developer.chrome.com/blog/richer-pwa-installation. This fed SEO-009.

Known background (not re-researched): FAQ rich results limited to authoritative government/health sites since Aug 2023 and HowTo rich results retired. The FAQPage JSON-LD on landing pages is harmless but won't produce rich snippets.

Not yet explored (ideas for future runs): keyword volumes for game + "score sheet/keeper/counter"; r/SEO and r/TechSEO threads on PWA indexing; PWA directories (e.g. store.app, appsco.pe); Commander/EDH community sites and darts forums that allow tools; seasonal tie-ins (Christmas / holiday card games); site name and favicon requirements in Google Search; AI-search visibility (ChatGPT/Bing citations, llms.txt); hreflang for UK darts vs US terminology.
