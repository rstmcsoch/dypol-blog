# Admin guide

This guide explains every part of the DYPOL Blog admin panel in plain language. Open it any time from **Help** in the admin menu.

## Signing in

- The admin panel lives at `/admin` — that is also where you sign in: visiting `/admin` signed out shows the sign-in form right there. (Old `/login` bookmarks permanently redirect to `/admin`.)
- **Recommended sign-in: username + password + authenticator app (2FA).** Set it up once under **Admin → Security**: choose a username and a password (12+ characters), scan the QR code with any authenticator app (Google Authenticator, Authy, 1Password…), enter the 6-digit code it shows, and save the 10 recovery codes somewhere safe — they are shown only once and each works once if you lose your phone.
- The moment you confirm that first code, **admin-token sign-in switches off**. Until then the token keeps working, so starting setup can never lock you out.
- Your password is stored only as a one-way scramble (PBKDF2). The authenticator secret is stored encrypted. Nobody — including anyone reading the database — can read either back.
- After 5 wrong attempts in a minute (either step), sign-in pauses for about a minute. Errors never say whether it was the username, the password or the code that was wrong.
- Signing out now truly ends that session on the server, immediately — not just in the browser.
- **If you lose your authenticator:** use a recovery code at the code step.
- **If you lose everything (phone + recovery codes):** open Cloudflare → D1 → `dypol-blog-db` → Console and run `DELETE FROM admin_recovery_codes; DELETE FROM admin_users;` — admin-token sign-in comes back at once and you can set up again under Security. Only you can do this, because it needs your Cloudflare account.
- The old **admin token** (`ADMIN_TOKEN` secret) is still needed by the server even after password sign-in is on — it helps protect your sessions and is the emergency door above. Keep it set, keep it long, never give it to an AI app.
- Changing `ADMIN_TOKEN` (or `ADMIN_SESSION_SECRET`) signs everyone out immediately — and also makes the stored authenticator secret unreadable, so afterwards sign in with a recovery code and reset the authenticator under Security. Do this only if you think a secret leaked.
- If the sign-in page says it is locked, the Worker has no `ADMIN_TOKEN` secret set yet.

## Articles

- **Articles** lists everything: published articles, drafts and unpublished ones. Filter by status, topic or tag, or search by title.
- **Draft**: saved but not visible on the site. **Published**: visible to everyone. **Unpublished**: taken off the site, kept in the admin so you can publish it again.
- **Publish** makes an article public. **Unpublish** removes it from the site without deleting it.
- **Delete** removes an article permanently, in any status (a published article disappears from the site at once). Its tag links are removed too. Its cover image file stays in Media unless you tick “also delete the cover image file” (it is only deleted if no other article, logo or icon uses it). Deleting cannot be undone.
- **Delete old articles** (panel at the bottom of **Articles**): delete many articles at once by age. Pick how old (1 week, 1 month, 3 months, or a custom number of days) and which group — drafts and unpublished (the safest, and the starting choice), drafts only, unpublished only, published only, or everything. An article's date is its **publish date** when published, otherwise its **last-saved date**; only articles dated *before* the day shown are matched, and the panel lists exactly what will go before anything happens. Including published articles shows a warning, because they vanish from the public site at once. The final confirmation shows the exact count and needs a ticked checkbox before the delete button works. Cover image files stay in Media, just like deleting one article without ticking its cover box. This is admin-only — AI over MCP cannot use it.
- **Featured**: the one article shown big at the top of the homepage. If none is marked, the newest is used.
- **Allow AI to edit this article** (in the editor of a *published* article, or the button in the Articles list): published articles are locked for AI over MCP by default. Turning this on lets an AI revise that one article's text, tags and cover — it still can never delete it, unpublish it, or change its slug or status. The list shows an “AI edit allowed” badge while it is on. Turn it off when the revision is done. Needs D1 migration `0006_ai_edit.sql` applied to the database.

## Cover images

- A **cover image** is the picture at the top of an article and on the homepage hero. Set it in the article editor (upload it under **Media** first).
- If an article has no cover image, the site shows a fallback you choose under **Appearance → Articles without a cover image**:
  - **Simple panel** (recommended): a quiet panel with the topic and title.
  - **Pattern**: the original geometric pattern (orange blocks and a number). The editor's “Fallback pattern” setting picks its shape.
  - **No cover**: the article starts straight with the text.
- AI automation must send a real image of at least 400×200 pixels; tiny or placeholder images are refused. When it uses someone else's image it must add a credit line, which appears at the end of the article.

## Topics & tags

- **Topics** are the main sections of the blog. The blog ships with a fixed list of 25 (Artificial Intelligence & AI Tools, Smartphones/Android/iPhone & Wearables, Product Reviews, Tech News, Leaks, …). Topics appear in the menu page “Topics” and on the homepage.
- An article can be filed under **several topics at once** (up to 4): pick the **Main topic** in the article editor, then tick “Also file under these topics”. The article is listed on every one of its topic pages; the main topic is the one shown first on cards.
- The AI files its own articles the same way: it reads the 25 topics and picks the 1–4 that fit each article's content, so you don't need to sort AI drafts into topics yourself. It can only use topics from this list — anything else is rejected with the valid list so it can retry.
- **Tags** are optional extra labels. An article can have several. There are no built-in tags any more; create your own here if you want them.
- Rename a topic or tag any time: articles stay attached. A topic or tag still used by an article cannot be deleted; move those articles first.
- The 25 topics are also built into the code as a backup (see “When the database is down”). Needs D1 migration `0007_canonical_topics.sql` applied to the database; it files every existing article under the closest new topic (anything unmatched lands in Tech News) and removes the old default topics and tags — no article is deleted or changed.

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
- The AI cannot do anything else with your site: no access to your admin session, no settings changes. It can edit and delete **drafts** (see “Editing drafts” below), but published articles are locked unless you grant one article (see Articles).
- You connect an AI app once (see `docs/automation/README.md` for each app). Apps that support it open an approval page where you paste your **MCP token**; command-line apps send the token in a header.
- The **schedule** (for example “every morning at 8”) is set in the AI app, not here. The instructions to give the AI are in `docs/automation/automation-prompt.md`.

### Editing drafts

- An AI can fully revise **drafts it created** over MCP (`list_editable_articles`, `get_article`, `update_article_draft`, `set_article_cover`, `remove_article_cover`, `delete_article_draft`). Editing never publishes by itself.
- **Publishing has two paths, plus two hard limits.** *Automatic* publishing (during submit / cover attach) obeys your Publishing policy below: allowed topics, quality flags, featured-image rule. *Explicit* publishing — the AI deliberately calling `publish_article_if_allowed` on a draft — works for drafts that profile may edit (master token: any draft); the policy does not block it, and the tool reports what the policy would have said as warnings. **Hard limits block both paths:** "Maximum articles per run" (Automation tab, per profile — one run = one run_id the AI sends, or publishes less than 30 minutes apart) and "Maximum AI-published articles per day (whole website)" (Settings — every AI publish across all profiles per UTC day). Publishing manually in the admin panel is never counted or blocked. The Recent runs list marks these “published (explicit)” versus “published (automatic)”. Once published, only you control the article: the AI cannot unpublish, delete, re-publish or change its status (edits only with the per-article grant above).
- The **master MCP token** can edit any draft. A profile can edit other profiles' (or your own admin-written) drafts only if you tick **“AI may edit drafts created by other automations”** in that profile's Publishing policy (off by default).
- **Published articles are locked** for AI. To let the AI revise one, open it in the editor and tick **“Allow AI to edit this article”** (or use the button in the Articles list). Even then the AI cannot delete it, unpublish it, or change its slug/status. Revoke the grant when done.
- Deleting a draft through MCP needs an explicit confirm plus the draft's slug echoed back, so an AI cannot delete the wrong piece by accident. Cover files follow the same keep/delete-if-unused rule as admin deletes.
- Every edit, cover change, delete and refusal is written to the profile's run log below.

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
- `ADMIN_TOKEN` is your emergency sign-in key and part of how admin sessions are protected. Never give it to an AI app. (Signing in day-to-day uses your username, password and authenticator — see “Signing in”.)
- Secrets live in Cloudflare (Workers → your worker → Settings → Variables and Secrets, type **Secret**). They are never in the code or database. A secret added as plain text instead of **Secret** can be wiped by the next deploy.
- Optional AI provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `AI_API_KEY`) are only for the future “server-api” mode. Nothing uses them yet, and the site never calls an AI service by itself.

### Pages (About, Privacy, Terms…)

Admin → **Pages** manages the standard reader-facing pages: **About Us** (`/about`), **Privacy Policy** (`/privacy-policy`), **Terms and Conditions** (`/terms`), **DMCA / Copyright Policy** (`/dmca`), **Cookie Policy** (`/cookie-policy`), **Editorial Policy** (`/editorial-policy`), **Corrections Policy** (`/corrections-policy`), **Contact** (`/contact`) and **Disclaimer** (`/disclaimer`).

- **Edit** any page: change its title, web address (slug), body and status, then save. The body uses light markdown (`##` headings, `-` lists, `**bold**`, `[text](/path)` links).
- **Hide** a page (status → Hidden) to remove it from the site, footer and sitemap without deleting it; set it back to Published to restore it.
- **Delete** removes a page permanently (you confirm first). Deleting `/about` removes the About page too — hide instead if you might bring it back.
- **Add** a new page with the form at the top; it appears at `/its-slug`, in the footer and in the sitemap automatically. Slugs the site itself uses (`/articles`, `/topics`, `/admin`…) are refused.
- The AI has **no access** to pages — only a signed-in admin can change them. Legal pages carry an effective date; update it when you change the text.

## Publishing rules

- **Enabled / Paused**: when off or paused, the AI can still read settings but cannot write.
- **Allow automatic publishing**: off means every AI article stays a draft for you to review. On means an AI article is published only if ALL rules pass: its topic is allowed under “Topics automation may publish into” (no topic ticked there = **every** topic is allowed; an article with several topics passes if any one of them is ticked), it has enough words and sources, has a cover image if you require one, has no warning flags (too short, missing sources, placeholder text, duplicate title, the AI said it was unsure, missing cover image), and the daily limit is not reached.
- If a rule fails, the article stays a draft and the reason appears under **Recent runs**.
- “Featured image transfer from your AI app” is only a note for yourself; it does not change behaviour.

## Preview vs production

- **Production** is the live site visitors see (`dypolblog.rstmcsoch.workers.dev`). It uses the production database and storage.
- A **preview** is a test copy built automatically for every code branch / pull request (an address like `<branch>-dypolblog.rstmcsoch.workers.dev`). Previews use a separate test database and storage, so nothing you do there touches the live site. Previews have their own secrets.
- Code changes reach production only when a pull request is merged into `main`.

## When the database is down

If the database cannot be reached, public pages still load using the original built-in articles, topics and settings, so the site never shows an error page. Your own changes (new articles, renamed topics, site text, appearance) come back as soon as the database is reachable. The admin panel needs the database and will show an error meanwhile.
