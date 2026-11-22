# Score Chalk SEO research log

Topics, sources and queries per run, newest first. Use it to avoid repeating ground.

## 2026-11-22 (run 2)

This run reached the live site (scorechalk.com returned 200). The PageSpeed Insights API returned 429 again, so nothing was measured. WebFetch couldn't resolve developers.google.com because it isn't in the session's allowed domains, so Google docs were read only through search-result summaries.

Topics:
1. **Favicon and site name in Google Search.** Query: "Google Search favicon requirements multiple of 48px crawlable rel icon home page data URI". Sources: developers.google.com/search/docs/appearance/favicon-in-search (via search summary); searchenginejournal.com/google-now-recommends-higher-resolution-favicons/530793/; logo.dev/docs/brand-visibility/google-favicon. Takeaways: the icon is read from the home page and has to be crawlable by Googlebot-Image at a stable URL, square, and 48px or larger is recommended. Data URIs aren't documented as supported. This fed SEO-017.
2. **AI-search visibility / llms.txt.** Query: "llms.txt adoption evidence AI search citations Google ChatGPT 2026". Sources: ahrefs.com/blog/llmstxt-study/ (97% of files never fetched, May 2026); searchenginejournal.com/llms-txt-shows-no-clear-effect-on-ai-citations-based-on-300k-domains/; searchengineland.com/llm-only-pages-ai-search-467690. Takeaway: Google says it isn't used for search and there's no measurable citation lift, so no suggestion was made. robots.txt already allows all bots, including OAI-SearchBot. Bing indexing (SEO-004/005) is the route that matters for ChatGPT search.
3. **Redirect status codes / trailing slashes on Workers static assets.** Queries: "Google search 307 redirect trailing slash Cloudflare Workers static assets html_handling canonical"; "Google search 307 temporary redirect canonical signal source URL indexed Search Central". Sources: developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling; github.com/cloudflare/workers-sdk/issues/5262; developers.google.com/search/docs/crawling-indexing/301-redirects. Takeaway: the asset store uses 307, which Google treats as a weak canonical signal. This fed SEO-018. The live HTTP checks also found SEO-016 (no HTTPS redirect).
4. **PWA directories.** Query: "PWA directory submit progressive web app listing store.app appsco.pe 2026". Sources: Product Hunt listings for pwastore.io and PWA List; alternativeto.net/software/pwa-list/about (discontinued May 2025); mobiloud.com/blog/publishing-pwa-app-store. Couldn't confirm appsco.pe. This fed SEO-020.
5. **Seasonal / holiday card games.** Query: "most popular card games played at Christmas family holiday score keeping …". Sources: denofgeek.com best card games this Christmas; talkofthehouse.com 12 best family card games for holidays (2026); cbc.ca; onmilwaukee.com (euchre, sheepshead). Takeaway: Skyjo, Five Crowns, UNO, Oh Hell and Rummy 500 recur. This fed SEO-021.

Not yet explored (ideas for future runs): keyword volumes (needs Search Console data); r/TechSEO threads on JS-rendered app pages; Commander/EDH and darts communities that allow tools (EDHREC, r/Darts rules); hreflang/UK vs US darts terms; Phase 10 and Rummikub search demand; image SEO (alt text, image sitemap for og/ images); Core Web Vitals once PSI is reachable (consider an API key).

## 2026-11-22 (first run)

Live site and PageSpeed Insights were **not reachable** from the sandbox: scorechalk.com blocked by the session's network policy (curl 403 from the egress proxy, WebFetch DNS failure). PSI API returned 429 (daily quota on the keyless shared project). The audit is source-only.

Topics:
1. **Canonicals vs noindex for parameter URLs.** Query: "Google Search Central web app PWA SEO canonical query parameter noindex 2026". Sources: developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls; searchengineland.com/canonicalization-seo-448161. Takeaway: canonical is for duplicates, noindex is for pages that shouldn't be in the index. Don't mix them on one URL. This fed SEO-001 and SEO-002.
2. **IndexNow / Cloudflare Crawler Hints / Bing Webmaster.** Query: "IndexNow Cloudflare Crawler Hints Bing Webmaster Tools setup". Sources: developers.cloudflare.com/cache/about/crawler-hints/; blog.cloudflare.com/cloudflare-now-supports-indexnow/; bing.com/indexnow/getstarted. Takeaway: one-click, driven by cache misses. This fed SEO-005.
3. **Competitor scorekeeper apps and the games they target.** Query: "best score keeper app online card games … Rummy Phase 10 Hearts Spades". Sources: App Store listings for HD Score Keeper, Scotee, Card Score Keeper, Score Keeper for Five Crowns, ScoreApp, DeckScore. Takeaway: Spades, Hearts, Phase 10, Five Crowns and Rummy are the common headline games. This fed SEO-011 and SEO-012.
4. **Manifest screenshots / Richer Install UI.** Query: "web app manifest screenshots richer install UI Chrome form_factor". Sources: web.dev/articles/web-apps/richer-install-ui; developer.chrome.com/blog/richer-pwa-installation. This fed SEO-009.

Known background (not re-researched): FAQ rich results limited to authoritative government/health sites since Aug 2023 and HowTo rich results retired. The FAQPage JSON-LD on landing pages is harmless but won't produce rich snippets.

Not yet explored (ideas for future runs): keyword volumes for game + "score sheet/keeper/counter"; r/SEO and r/TechSEO threads on PWA indexing; PWA directories (e.g. store.app, appsco.pe); Commander/EDH community sites and darts forums that allow tools; seasonal tie-ins (Christmas / holiday card games); site name and favicon requirements in Google Search; AI-search visibility (ChatGPT/Bing citations, llms.txt); hreflang for UK darts vs US terminology.
