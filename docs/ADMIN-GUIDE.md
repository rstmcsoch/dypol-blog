# Admin guide

This guide explains every part of the DYPOL Blog admin panel in plain language. Open it any time from **Help** in the admin menu.

## Signing in

- The admin panel lives at `/admin`. You sign in at `/login` with your **admin token**.
- The token is a long random password stored as the `ADMIN_TOKEN` **secret** on the Cloudflare Worker. It is never stored in the code or the database.
- Changing `ADMIN_TOKEN` (or the optional `ADMIN_SESSION_SECRET`) signs everyone out immediately. Do this if you think the token leaked.
- After 5 wrong attempts in a minute, sign-in pauses for about a minute.
- If the sign-in page says it is locked, the Worker has no `ADMIN_TOKEN` secret set yet.

## Articles

- **Articles** lists everything: published articles, drafts and unpublished ones. Filter by status, topic or tag, or search by title.
- **Draft**: saved but not visible on the site. **Published**: visible to everyone. **Unpublished**: taken off the site, kept in the admin so you can publish it again.
- **Publish** makes an article public. **Unpublish** removes it from the site without deleting it.
- **Delete** removes an article permanently, in any status (a published article disappears from the site at once). Its tag links are removed too. Its cover image file stays in Media unless you tick “also delete the cover image file” (it is only deleted if no other article, logo or icon uses it). Deleting cannot be undone.
- **Featured**: the one article shown big at the top of the homepage. If none is marked, the newest is used.

## Cover images

- A **cover image** is the picture at the top of an article and on the homepage hero. Set it in the article editor (upload it under **Media** first).
- If an article has no cover image, the site shows a fallback you choose under **Appearance → Articles without a cover image**:
  - **Simple panel** (recommended): a quiet panel with the topic and title.
  - **Pattern**: the original geometric pattern (orange blocks and a number). The editor's “Fallback pattern” setting picks its shape.
  - **No cover**: the article starts straight with the text.
- AI automation must send a real image of at least 400×200 pixels; tiny or placeholder images are refused. When it uses someone else's image it must add a credit line, which appears at the end of the article.

## Topics & tags

- **Topics** are the main sections of the blog (for example Design, Systems). Every article belongs to exactly one topic. Topics appear in the menu page “Topics” and on the homepage.
- **Tags** are optional extra labels. An article can have several.
- Rename a topic or tag any time: articles stay attached. A topic or tag still used by an article cannot be deleted; move those articles first.
- The four original topics are also built into the code as a backup (see “When the database is down”).

## Media

- Upload JPEG, PNG, WebP or GIF images. They are stored in Cloudflare R2 storage.
- An image used as a cover, logo or browser icon cannot be deleted until you stop using it.

## Homepage & layout

- **Homepage** (admin → Homepage): this is a builder. Add, remove, reorder and edit blocks. Block types: big featured article, latest articles, “You may also like”, a block for any one topic/category (you can add the same type several times for different topics), topics list, tags, the top strip, your own text, and a button/link block. For each block you can change its heading, how many items it shows, its layout where offered, and show/hide it. Changes are only on the homepage.
- **Article sidebar** (same builder controls on the article settings): the column next to article text. Add/remove/reorder the same kinds of blocks there (tags, related articles, newest articles, share buttons, and more). Turn the sidebar off and articles use the full width. On phones the sidebar appears under the article.
- **Top strip / Ticker** (admin → Top strip / Ticker): the thin strip under the header. Turn it on/off (it is on by default), change its label, choose what it shows — newest articles, articles you pick, most-read articles, or your own text items — choose how many items, and how it moves: one at a time, continuous scroll, or still. Set the speed for moving modes. If the source you picked has nothing to show, it automatically shows the newest articles so the strip does not disappear. “Most read” uses a simple anonymous count: one number per article, no visitor tracking, no cookies.
- **Admin light/dark**: use the sun/moon button at the top-right of the admin panel. One click switches between light and dark. This only changes the admin panel, not the public website, and your choice is remembered on that device. On your first visit it follows your device setting.

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

An AI app (Claude, ChatGPT, Grok, Cursor, Claude Code, …) can research and write draft articles for you on a schedule. The AI does the writing; the site only checks, stores and (only if your rules allow) publishes.

### The MCP connector

- **MCP** (Model Context Protocol) is a standard way for AI apps to use tools on other websites. Your site offers a small set of tools at `https://<your site>/mcp`: read the settings, list recent articles, submit a draft, try to publish, upload a cover image, and record the result of a run.
- The AI cannot do anything else: no deleting, no editing other articles, no access to your admin session.
- You connect an AI app once (see `docs/automation/README.md` for each app). Apps that support it open an approval page where you paste your **MCP token**; command-line apps send the token in a header.
- The **schedule** (for example “every morning at 8”) is set in the AI app, not here. The instructions to give the AI are in `docs/automation/automation-prompt.md`.

### How topics are chosen (per profile)

- In **AI automation**, under “How topics are chosen”, each profile picks one way:
  - **Trend first**: the AI first looks at what is hot now on the sources you tick (Google News, Web, X, other social), then writes about the best-fitting trend. If nothing fits, it does what your fallback says.
  - **Random**: the site suggests one random idea from your list each time the AI connects.
  - **In order (loop)**: the AI works through your list in order. “Step” means take every Nth idea (step 3 = every 3rd), looping back to the start. The admin shows the next topic; the position only moves when a draft is actually submitted.
  - **Let AI choose**: the AI picks freely from your list and its own research (the old behaviour).
- You can save up to **500 topic ideas** per profile (one per line).

### Multiple automations (profiles)

- You can run several automations on the same website at the same time. Each one is a named **profile** (for example “Daily tech” and “Weekly design”).
- Each profile has its own on/off and pause switch, its own topic ideas and sources, its own allowed topics, publishing rules and daily limit.
- Each profile can have its own connection key (token). Create it in the profile list: it is shown **once**, so copy it straight into that AI app. Only a scrambled copy is stored on the website, so it cannot be read back later. Revoke a profile's key at any time and that AI app loses access immediately, without affecting the others.
- The main `MCP_TOKEN` secret still works and belongs to the profile called **Default**. Your existing settings became the Default profile, so nothing changed for automations you already had.
- Every run in Recent runs shows which profile made it.
- **Times:** this website has no scheduler and never starts a run by itself. In each profile, write the timezone, days and times you set in that profile's AI app (Grok Automation, a Claude scheduled task, or a cron job). The admin then shows the “next expected run” from those times — that is only an expectation, not a promise. Several profiles can be on at the same time; pausing one does not pause the others, and each profile's daily publishing limit is counted separately.
- Could the website run profiles itself in future? Only with a Cloudflare Cron Trigger in server-api mode (the site calling an AI provider with your API key secret). That is not switched on, because it needs cost limits and a separate safety review.

### Tokens and secrets

- `MCP_TOKEN` is a separate password just for AI apps. Changing it disconnects every AI app at once.
- `ADMIN_TOKEN` is only for you to sign in. Never give it to an AI app.
- Secrets live in Cloudflare (Workers → your worker → Settings → Variables and Secrets, type **Secret**). They are never in the code or database. A secret added as plain text instead of **Secret** can be wiped by the next deploy.
- Optional AI provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `AI_API_KEY`) are only for the future “server-api” mode. Nothing uses them yet, and the site never calls an AI service by itself.

### Publishing rules

- **Enabled / Paused**: when off or paused, the AI can still read settings but cannot write.
- **Allow automatic publishing**: off means every AI article stays a draft for you to review. On means an AI article is published only if ALL rules pass: its topic is ticked under “Topics automation may publish into”, it has enough words and sources, has a cover image if you require one, has no warning flags (too short, missing sources, placeholder text, duplicate title, the AI said it was unsure, missing cover image), and the daily limit is not reached.
- If a rule fails, the article stays a draft and the reason appears under **Recent runs**.
- “Featured image transfer from your AI app” is only a note for yourself; it does not change behaviour.

## Preview vs production

- **Production** is the live site visitors see (`dypolblog.rstmcsoch.workers.dev`). It uses the production database and storage.
- A **preview** is a test copy built automatically for every code branch / pull request (an address like `<branch>-dypolblog.rstmcsoch.workers.dev`). Previews use a separate test database and storage, so nothing you do there touches the live site. Previews have their own secrets.
- Code changes reach production only when a pull request is merged into `main`.

## When the database is down

If the database cannot be reached, public pages still load using the original built-in articles, topics and settings, so the site never shows an error page. Your own changes (new articles, renamed topics, site text, appearance) come back as soon as the database is reachable. The admin panel needs the database and will show an error meanwhile.
