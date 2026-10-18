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

- **Homepage sections**: turn the featured article, the “Also filed” band, the latest list and the topics grid on or off, change their order with the arrows, rename their headings and choose how many items each shows.
- **Top news strip (ticker)**: the thin strip under the header. Choose its label, whether it shows the newest articles, articles you pick, or your own text items (each can link anywhere), how many items, and whether it scrolls continuously and how fast. Scrolling pauses when a visitor hovers over it and is switched off for visitors who ask their device for reduced motion.
- **Article sidebar**: the column next to the article text. Turn it off and articles use the full width. Or choose its blocks (tags, related articles, newest articles, share buttons), their order and headings, and how many articles each list shows. On phones the sidebar appears under the article.

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
