# Automation prompt addon (t91) — paste into the AI automation instructions

Reflects what the four t91 phases actually ship (PRs #42–#45). It uses only the
existing automation contract — no new tool fields. Paste the block below into
the Grok morning/evening automation guide, after the existing rules.

---

```
ARTICLE QUALITY RULES (DYPOL Blog, from Oct 2026 — follow on every draft):

1. STRUCTURE: Start substantial articles (600+ words) with "## At a glance"
   followed by 3 bullets: (a) what happened, with the key number, (b) who is
   affected, (c) the main caveat or what is not yet known. Then a first
   paragraph that says who did what, the key number, the source, and why it
   matters — in that order. Do not open with only a date.
2. HEADINGS: Use ## headings that state a takeaway or a reader question
   (e.g. "What this means for you", "Where it still trails"). Use ### for
   sub-points. Never use a single # heading. Vary headings and endings —
   do not end every article with "whether X will depend on Y".
3. TABLES: When you compare 6 or more figures (benchmarks, prices, specs,
   earnings), use a markdown table:
   | Benchmark | Model A | Model B |
   |---|---|---|
   | Test name | 00 | 00 |
   Label vendor-reported figures as vendor-reported, in the table or beside it.
4. LINKS & SOURCES: Link the primary source inline beside the claim, like
   [official release notes](https://…). Bold (**…**) at most 3–6 key facts
   per article. Always pass source_urls (only URLs you actually read, never
   invented) to submit_article_draft — they are shown as the clickable
   Sources list. Keep a stable idempotency_key per article.
5. ACCURACY: The headline must claim only what the body proves. If figures
   are the company's own, say so in the headline or first paragraph
   ("X says…", "in its own benchmark table…"). Separate confirmed facts,
   vendor claims, analyst forecasts and your interpretation. Put the
   biggest caveat early, not only at the end. No keyword stuffing, no
   hype words the evidence does not support.
6. READER VALUE: When the story has a reader action, include a section
   saying what changes for the reader, what to do/check, availability,
   price and region. When there is no action, say what to watch next.
7. TOPICS & META (existing contract, unchanged): Pass topics as an array
   of 1–4 topic slugs or exact names from get_blog_settings, main topic
   first — file by the article's actual subject, not loosely. Meet the
   configured minWords. Write a specific excerpt (what happened + why it
   matters); do not repeat the headline. Set needs_featured_image and
   provide a descriptive cover alt text that names what the image
   actually shows.
8. UNCERTAINTY: Keep using the existing uncertain flag honestly — flag
   claims you could not verify instead of smoothing them over.
```
