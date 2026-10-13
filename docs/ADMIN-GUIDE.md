# Admin guide

This guide explains every part of the DYPOL Blog admin panel in plain language. Open it any time from **Help** in the admin menu.

## Signing in

- The admin panel lives at `/admin`. You sign in at `/login` with your **admin token**.
- The token is a long random password stored as the `ADMIN_TOKEN` **secret** on the Cloudflare Worker. It is never stored in the code or the database.
- Changing `ADMIN_TOKEN` (or the optional `ADMIN_SESSION_SECRET`) signs everyone out immediately. Do this if you think the token leaked.
- After 5 wrong attempts in a minute, sign-in pauses for about a minute.
- If the sign-in page says it is locked, the Worker has no `ADMIN_TOKEN` secret set yet.

## The admin menu

- **Content — Dashboard, Articles, Topics & tags, Media.** Writing and organising the blog.
- **Site — Homepage builder, Sidebar manager, Trending ticker, Site text, Appearance.** How the public site is put together.
- **Automation — Automations, History & diagnostics.** The AI writers and what they did.
- **System — Settings, Help.** Site basics and this page.

You can switch the panel between **Light**, **Dark** and **System** (follow the device) at the top of the menu. The choice is saved in a cookie and applied before the page paints, so there is no flash; it never changes the public site's theme. If the choice cannot be saved, the button rolls back and says so.

## Articles

- **Articles** lists everything: published articles, drafts and unpublished ones. Filter by status, topic or tag, or search by title.
- **Draft**: saved but not visible on the site. **Published**: visible to everyone. **Unpublished**: taken off the site, kept in the admin so you can publish it again.
- **Publish** makes an article public. **Unpublish** removes it from the site without deleting it.
- **Delete** removes an article permanently, in any status (a published article disappears from the site at once). Its tag links are removed too. Its cover image file stays in Media unless you tick “also delete the cover image file” (it is only deleted if no other article, logo or icon uses it). Deleting cannot be undone.
- **Featured**: the one article shown big at the top of the homepage. If none is marked, the newest is used.

## Cover images

- A **cover image** is the picture at the top of an article and in the hero block. Set it in the article editor (upload it under **Media** first).
- If an article has no cover image, the site shows a fallback you choose under **Appearance → Articles without a cover image**:
  - **Simple panel** (recommended): a quiet panel with the topic and title.
  - **Pattern**: the original geometric pattern (orange blocks and a number). The editor's “Fallback pattern” setting picks its shape.
  - **No cover**: the article starts straight with the text.
- AI automation must send a real image of at least 400×200 pixels; tiny or placeholder images are refused. When it uses someone else's image it must add a credit line, which appears at the end of the article.

## Topics & tags

- **Topics** are the main sections of the blog (for example Design, Systems). Every article belongs to exactly one topic. Topics appear on the “Topics” page and in topic blocks.
- **Tags** are optional extra labels. An article can have several.
- Rename a topic or tag any time: articles stay attached. A topic or tag still used by an article cannot be deleted; move those articles first.
- The four original topics are also built into the code as a backup (see “When the database is down”).

## Media

- Upload JPEG, PNG, WebP or GIF images. They are stored in Cloudflare R2 storage.
- An image used as a cover, logo or browser icon cannot be deleted until you stop using it.

## Homepage builder

The homepage is a list of **blocks** you own. Open **Site → Homepage builder**.

- **The library** offers: Featured article (hero), Article list, Topic navigation, Tag collection, Text block and Announcement. Add any of them as many times as you like.
- **Article list** is one block that covers every listing the site really supports: latest articles, trending (most read this week), popular (most read all time), featured, recently updated, by topic, by tag, the articles you pick by hand (in your order), or “related to this article” (article pages only). You also choose how many items, the layout (index, grid, list), columns, whether images/excerpts/meta show, and what happens when nothing matches (hide the block, or show its heading with a short note).
- **Reorder** with the arrows, **enable/disable** with the switch, **duplicate** with Copy, **delete** with Delete. Every block has a heading, an optional description and an optional “view all” link.
- **Save draft** stores your working copy; the public site keeps showing the published layout until you press **Publish**. **Discard draft** throws the draft away, **Reset to default** puts the original factory layout back.
- **Preview** shows the real page rendered from your draft (published articles only), so you can check it before publishing.
- If you have never saved anything, the site keeps rendering the original homepage — nothing changes until you publish.
- A block that has nothing to show (for example a Tag collection with no tags, or an empty Text block) hides itself instead of leaving an empty box.

## Sidebar manager

Open **Site → Sidebar manager**.

- The sidebar is the column beside the article text, and it is **independent of the homepage**: the same block types are available (article list, topic navigation, tag collection, this article's tags, share buttons, text block) but with their own settings.
- Turn the whole sidebar **off** and articles use the full width. On phones the sidebar always sits under the article.
- “This article's tags”, “Share buttons” and “related to this article” only mean something on an article page, and the desk only offers them there.
- Same draft → publish flow as the homepage builder, with its own preview.

## Trending ticker

The thin strip under the masthead. Open **Site → Trending ticker**.

- **Source**: Trending — most read recently (ranked by reads recorded on this site; until reads build up, the newest articles are shown and the preview says so), Newest articles, Featured articles, Articles in chosen topics, Articles I pick, or My own text items with optional links.
- **Mode**: **One headline at a time (rotates)** — exactly one headline is visible and it advances on your interval, with ‹ › buttons and an optional “3 / 8” counter; or **One headline, no rotation**.
- Also yours to set: the label (“Now”), whether the label and counter show, how many items, the rotation speed (10–180 seconds), and pausing while a visitor hovers or uses the keyboard.
- **Preview** renders the strip from your current settings using real published articles. Nothing unpublished can reach it.
- Visitors who ask their device for reduced motion never get automatic movement; they can still use the arrows. A missing pinned article or an empty result falls back to the newest articles and says so; switching the ticker off hides it completely.

## Site text

Every word visitors see outside your articles: menu labels (and which menu items are visible), headings such as “Continue”, “You may also like” and “New stories”, buttons, the footer line and links, the About page, and error pages. **Reset** puts the default text back. Text is saved in the database; if a value is missing, the default is used.

## Appearance

- **Night theme darkness** (75–100%): 100% is pure black; lower values give a softer charcoal grey.
- **Day theme whiteness** (85–100%): 100% is pure white; lower values give a soft off-white.
- **Accent colour**: the single highlight colour (the ticker label, highlights). The text on top of it switches between black and white automatically.
- Text colours are adjusted automatically so they stay readable (at least 7:1 contrast for body text and 4.5:1 for secondary text). The live preview shows both themes before you save.
- Visitors choose Day or Night with the switch in the header; their device setting is used until they choose.

## AI automation

### What it is

An AI app (Claude, ChatGPT, Grok, Cursor, Claude Code, …) can research and write draft articles for you. That is the **MCP connector** mode. Or the site itself can ask an AI provider for an article on a schedule — the **server API** mode, described under “Automations” below.

The AI does the writing; the site only checks, stores and (only if your rules allow) publishes.

### The MCP connector

- **MCP** (Model Context Protocol) is a standard way for AI apps to use tools on other websites. Your site offers a small set of tools at `https://<your site>/mcp`: read the settings, list recent articles, submit a draft, try to publish, upload a cover image, and record the result of a run.
- The AI cannot do anything else: no deleting, no editing other articles, no access to your admin session.
- You connect an AI app once (see `docs/automation/README.md` for each app). Apps that support it open an approval page where you paste your **MCP token**; command-line apps send the token in a header.
- The **schedule** (for example “every morning at 8”) is set in the AI app, not here. The instructions to give the AI are in `docs/automation/automation-prompt.md`.

### Tokens and secrets

- `MCP_TOKEN` is a separate password just for AI apps. Changing it disconnects every AI app at once.
- `ADMIN_TOKEN` is only for you to sign in. Never give it to an AI app.
- `CRON_SECRET` protects the scheduler URL `/api/automation/tick`. It is for an external cron service (or your own curl) and is never needed by a browser.
- The AI provider keys are the fixed set `AUTOMATION_A_KEY`, `AUTOMATION_B_KEY`, `AUTOMATION_C_KEY`, `AUTOMATION_D_KEY`, plus the provider-wide `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` and `AI_API_KEY`. An automation names exactly one of them, and a run may only use the one it names, so one key can never be spent by a writer that was not given it. Check **Automation → History & diagnostics** to see which names the deployment actually has: the desk shows whether a secret exists, a short fingerprint and its length — never the value.
- Secrets live in Cloudflare (Workers → your worker → Settings → Variables and Secrets, type **Secret**). They are never in the code or database. A secret added as plain text instead of **Secret** can be wiped by the next deploy.

### Automations

Open **Automation → Automations**. Each automation is one independent writer with its own settings, its own secret, its own schedule and its own publishing rules. Creating, copying, editing, pausing or deleting one never touches the others.

- **Name, on/off, paused**: a paused or disabled automation never runs and never asks a provider for anything.
- **Mode**: *MCP connector* (an AI app writes through `/mcp`; the site makes no AI calls) or *Server API* (the site calls the provider itself). A “Server API” automation must name a credential secret.
- **Provider, model, base URL**: kept per automation. The model list is a suggestion — type any model id. A base URL is only needed for “OpenAI-compatible” endpoints.
- **Topic ideas and source sites**: the topic list the automation rotates through, and any sites it should ground its research in. **Instructions** and **style/language/minimum words** are passed to the writer verbatim.
- **Topic, tags**: the fallback topic for pieces the provider does not place, plus tag labels it may choose from.
- **Image**: provider-generated covers (where the provider supports it), or “my AI app supplies the image” for MCP mode, with your own image prompt.
- **Publishing mode**: *Draft* (the safe default — you review everything) or *Auto*. Auto-publishing only happens when ALL rules pass: the automation is active, its topic is ticked under “Topics automation may publish into”, the piece is long enough, has enough real sources if you require them, has a cover if you require one, carries no blocking warning flag, and the daily limit is not reached. Otherwise it stays a draft and the reason is on the run.
- **Schedule**: a cron expression and a timezone, or leave it empty for manual-only. The desk shows the next time it will run in plain language. Schedules are honoured by the Worker's cron trigger and by the `/api/automation/tick` URL; a missed slot is not replayed, and one automation can never run twice at the same time.
- **Retries**: how many times a failed run may be retried and the wait between attempts (the wait grows with each attempt).
- **Run Now** asks for a real run immediately. **Dry run** does everything except writing: it shows the article it would have made, where it would have filed it, and which rules passed. **Test** makes one small provider call to prove the secret, model and endpoint work together — it never writes an article.

### History & diagnostics

Open **Automation → History & diagnostics**.

- **Recent runs** lists what actually happened: which automation, whether it ran or was skipped, the stage it stopped at, the reason, the attempt, how long it took, whether an article was written and whether it was published.
- **Skipped** is not **failed**: skipped means a rule said “not now” (nothing to write about, a duplicate title, the automation is off, another run holds the lock). Failed means something went wrong and is worth fixing.
- **Retry** runs the same automation again from here, and **Dry run** previews without writing.
- The diagnostics panel reports whether the scheduler is reachable, whether `CRON_SECRET` is set, which secrets exist (names and fingerprints only) and what the last tick did. Nothing on this page ever prints a key.

## Preview vs production

- **Production** is the live site visitors see (`dypolblog.rstmcsoch.workers.dev`). It uses the production database and storage.
- A **preview** is a test copy built automatically for every code branch / pull request (an address like `<branch>-dypolblog.rstmcsoch.workers.dev`). Previews use a separate test database and storage, so nothing you do there touches the live site. Previews have their own secrets.
- Code changes reach production only when a pull request is merged into `main`.

## When the database is down

If the database cannot be reached, public pages still load using the original built-in articles, topics and settings, so the site never shows an error page. Your own changes (new articles, renamed topics, site text, appearance) come back as soon as the database is reachable. The admin panel needs the database and will show an error meanwhile.
