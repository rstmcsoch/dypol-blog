/**
 * The standard reader-facing pages every news site carries (t52).
 * These texts are the built-in defaults: they seed the `pages` table
 * (migration 0008) and are the public fallback until the database has
 * the table. The owner can edit, hide or replace every one of them in
 * Admin → Pages — nothing here is hard-coded into the layout.
 *
 * Written for readers, about the publication. No site-mechanics or
 * design descriptions. Effective date for the policy pages: 18 October 2026.
 */

export type StandardPage = {
  slug: string;
  title: string;
  /** Short meta description for search/social. */
  description: string;
  /** Body in the site's safe markdown (headings, lists, links, bold). */
  body: string;
};

const EFFECTIVE = "18 October 2026";

export const STANDARD_PAGES: StandardPage[] = [
  {
    slug: "about",
    title: "About Us",
    description: "DYPOL BLOG is a technology news publication by DYPOL Labs covering AI, gadgets, cybersecurity, startups and the business of tech.",
    body: `DYPOL BLOG is a technology news and reviews publication, published by **DYPOL Labs**. We cover the technology that is changing how people live and work — and we try to explain it in plain language, without the hype.

## What we cover

Our reporting is organised into topics so you can follow the subjects you care about:

- **Artificial intelligence** — AI models, tools, research and the companies behind them
- **Phones, apps and software** — smartphones, wearables, apps and operating systems
- **Security and safety** — cybersecurity, privacy and online scams, explained so you can protect yourself
- **Companies and money** — big tech, competition, startups, funding and the business of technology
- **Hardware and gaming** — computers, chips and the games industry
- **What's next** — emerging technology, robotics, science, electric vehicles and clean technology
- **Guides and reviews** — hands-on product reviews, buying guides and developer tools
- **Policy and culture** — technology policy, social media, YouTube and internet culture, plus credible leaks

## How our stories are produced

DYPOL BLOG uses modern tools, and we are open about it. Our articles are researched and drafted with the help of AI systems, then **reviewed and approved by a human editor before anything is published**. Every story must be based on sources we can point to — you will find them listed at the end of each article. If a claim cannot be verified, it does not go in. You can read more in our [Editorial Policy](/editorial-policy).

When we get something wrong, we fix it openly. See our [Corrections Policy](/corrections-policy) for how that works.

## Our promise

- Explain technology clearly, for readers who are smart but busy
- Separate facts from opinion, and label each for what it is
- Credit the original reporting and images we build on
- Never publish a story we cannot stand behind

## Who publishes DYPOL BLOG

DYPOL BLOG is published by **DYPOL Labs**. To reach us — with a tip, a correction, or a business enquiry — see our [Contact](/contact) page.`,
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: "What data DYPOL BLOG collects, why, and the choices you have. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

DYPOL BLOG ("we", "us") is a technology news publication published by DYPOL Labs. This policy explains what information we collect when you read the site, why we collect it, and what we do with it. We keep data collection to a minimum.

## What we collect

- **Reading counts.** When you open an article, we record one anonymous view count for that article. It contains no name, no account, no IP address and no identifier that follows you between visits. It exists so we can see which stories readers find useful.
- **Server logs.** Our hosting provider (Cloudflare) processes standard technical logs — such as your IP address, browser type and the pages requested — to deliver the site, keep it secure and measure overall traffic. These logs are handled under Cloudflare's own privacy practices.
- **Preferences stored on your device.** The site remembers your day/night display choice on your own device (local storage, not a tracking cookie). It never leaves your browser.
- **Sign-in information (editors only).** The admin area is for our editors. Signing in sets one essential session cookie so an editor stays signed in; it is never used to track readers.
- **Anything you send us.** If you contact us, we receive what you choose to send (for example your name, contact details and message) and use it only to reply.

## What we do not do

- We do not sell personal information.
- We do not run third-party advertising trackers on the site today.
- We do not ask readers to create accounts, and we do not build reader profiles.

If we add privacy-friendly analytics or advertising in the future, we will update this policy first and describe what changed. See also our [Cookie Policy](/cookie-policy).

## Why we use this information

To run the site, keep it secure, understand which topics readers value, and respond to messages — nothing else.

## How long we keep it

Anonymous reading counts are kept as totals, not as records about individuals. Server logs are retained by our hosting provider for a limited period. Messages you send are kept only as long as needed to deal with them.

## Your choices and rights

Depending on where you live, you may have rights to access, correct or delete personal information about you, and to object to its use. Because we collect so little, there is usually nothing identifiable to retrieve — but if you believe we hold information about you, contact us via the [Contact](/contact) page and we will help.

## Children

DYPOL BLOG is a general-audience technology publication and is not directed at children under 13. We do not knowingly collect information from children.

## Changes to this policy

If this policy changes, we will update this page and the effective date above. Significant changes will be easy to spot because the previous promises above will be revised, not silently removed.`,
  },
  {
    slug: "terms",
    title: "Terms and Conditions",
    description: "The terms that govern your use of DYPOL BLOG. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

Welcome to DYPOL BLOG, a technology news publication published by DYPOL Labs ("we", "us"). By reading or using this website, you agree to these terms. If you do not agree, please do not use the site.

## The service

DYPOL BLOG publishes news, reviews, guides and commentary about technology. We may add, change or remove content and features at any time. We work to keep the site available and accurate, but we do not guarantee uninterrupted access.

## Using the site

You may read, link to and share our articles for personal, non-commercial use. You agree not to:

- misuse the site, attempt to break its security, or access the admin or automation areas without authorisation
- scrape or copy the site at scale in a way that burdens our infrastructure or republishes our work as your own
- use the site for anything unlawful, or to infringe anyone's rights

## Our content and intellectual property

Articles, text, layout and branding on DYPOL BLOG belong to DYPOL Labs or our licensors, unless stated otherwise. Images may come from third parties under licence and are credited where required; they remain the property of their owners. You may quote short excerpts with clear attribution and a link back to the original article. Anything more needs our written permission. See our [DMCA / Copyright Policy](/dmca) for how we handle copyright questions.

## Accuracy

We work hard to be accurate and we correct errors openly (see our [Corrections Policy](/corrections-policy)), but technology moves fast and information can become outdated. Content is provided for general information, reflects the position at the time of publication, and is not professional advice. Product prices, specifications and availability change without notice.

## Reviews and recommendations

Reviews reflect hands-on testing or careful research at the time of writing. They are editorial opinions, not guarantees that a product is right for you. Read our [Disclaimer](/disclaimer) for more, including how affiliate links would work if we ever use them.

## External links

We link to other websites for sources and further reading. We are not responsible for the content, accuracy or practices of sites we do not operate.

## Liability

To the extent permitted by applicable law, DYPOL BLOG and DYPOL Labs are not liable for indirect or consequential loss arising from your use of, or inability to use, the site or its content. Nothing in these terms limits liability that cannot be limited by law.

## Changes to these terms

We may update these terms from time to time. The version on this page, with its effective date, is the version that applies.

## Applicable law

These terms are governed by the applicable law of the jurisdiction in which the publisher operates. If any part of these terms is found unenforceable, the rest continues to apply.

Questions about these terms: see our [Contact](/contact) page.`,
  },
  {
    slug: "dmca",
    title: "DMCA / Copyright Policy",
    description: "How to report copyright infringement on DYPOL BLOG and how we respond. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

DYPOL BLOG respects the intellectual property of others. We write our own articles, license images where required, and credit sources. If you believe something on this site infringes your copyright, this page explains how to tell us and what happens next.

## How to send a takedown notice

Contact us via our [Contact](/contact) page, stating clearly that this is a **copyright takedown notice**, and include:

1. Your full name and how we can reach you
2. The work you own (or are authorised to act for) that you believe is infringed
3. The exact page address (URL) on DYPOL BLOG where the material appears
4. A short explanation of why you believe it infringes
5. A statement that you have a good-faith belief the use is not authorised by the owner, its agent or the law
6. A statement that the information you provide is accurate, and that you are the owner or authorised to act for them

## What we do

- We review every complete notice promptly.
- If the claim checks out, we remove or disable access to the material.
- Where the material came from a contributor, we tell them what happened and why.
- Incomplete notices slow things down — we may ask for the missing pieces.

## Counter-notices

If your material was removed and you believe that was a mistake — for example, you own the rights, had permission, or the use is lawful — contact us with the page address and your reasoning. We will review it and, where appropriate, restore the material in line with applicable law.

## Repeat infringements

We do not keep publishing material from sources that repeatedly infringe. Contributors or feeds that repeatedly supply infringing material will be removed.

## Images and credits

Many of our articles use images from libraries and creators who allow reuse (for example Wikimedia Commons, Unsplash and Pexels), credited at the end of the article. If you are the creator of an image we have used and would like the credit changed or the image removed, a takedown notice as above is the fastest route — credit fixes are usually quick and do not need the formal steps.

This policy works alongside the copyright terms in our [Terms and Conditions](/terms).`,
  },
  {
    slug: "cookie-policy",
    title: "Cookie Policy",
    description: "The cookies and local storage DYPOL BLOG uses — kept deliberately minimal. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

This page explains the cookies and similar storage DYPOL BLOG uses. The short version: **almost none**, and none for tracking readers.

## What we use

- **Session cookie (editors only, essential).** Keeps an editor signed in to the admin area. Readers never receive it.
- **Theme preference (every reader, functional).** Remembers your day/night choice on your own device, in local storage — not a cookie, and never sent to us.
- **Reading counts (every reader, anonymous).** One anonymous count per article view, stored on our side. It uses no cookie at all.

## What we do not use

- No advertising cookies
- No cross-site tracking or social-media pixels
- No reader accounts, and no cookies tied to your identity

## If this changes

If we add privacy-friendly analytics or advertising in the future, we will update this page and our [Privacy Policy](/privacy-policy) first, name what we added, and — where the law requires it — ask for your consent before anything non-essential runs.

## Controlling cookies

You can block or delete cookies in your browser settings. The public site will still work; editors simply will not stay signed in. Deleting local storage resets your day/night preference to the default.`,
  },
  {
    slug: "editorial-policy",
    title: "Editorial Policy",
    description: "How DYPOL BLOG chooses, researches, writes and reviews its stories — including how AI is used. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

DYPOL BLOG exists to explain technology clearly. This page explains how stories are chosen and produced, so you can judge our work for yourself.

## How we choose stories

We follow the subjects in our [Topics](/topics) — AI, phones, security, startups, hardware, culture and more — and pick stories that are genuinely useful or genuinely interesting to readers: a launch that matters, research that changes what we know, a scam people need to avoid, a product worth your money (or not).

## How stories are researched and written

We are open about our process: **articles are researched and drafted with the help of AI systems, working from real sources, and every article is reviewed and approved by a human editor before it is published.**

- Stories must be based on sources we actually read — company announcements, documentation, research papers, reputable reporting. Sources are listed at the end of every article.
- Facts that matter (numbers, dates, names, quotes) must be confirmed, preferably against a primary source.
- If a claim cannot be verified, it is left out or clearly flagged — never dressed up as fact.
- Articles are written in our own words. We do not copy other publications' reporting; where we build on someone's work, we credit and link them.

The AI never publishes on its own. A human being is responsible for every story on this site, and our [Corrections Policy](/corrections-policy) applies when we fall short.

## Independence

Editorial choices are ours. Coverage is not for sale: no company can pay to be featured, and review verdicts cannot be bought. If a commercial relationship ever touches a story, we will say so in the story. See also our [Disclaimer](/disclaimer).

## Reviews and buying guides

Reviews are based on hands-on testing where we say they are, and on careful, source-checked research where they are not — the article will make clear which. We compare against real alternatives, name the weaknesses as plainly as the strengths, and update guides when prices or products change materially.

## Images

We prefer images created for the story or licensed for reuse, always credited where the licence requires. We do not use other publications' photography.

## Standards we hold ourselves to

- Headlines that match the story — no clickbait
- Dates on everything; updates marked, not hidden
- Facts over speculation, and speculation labelled as such
- A corrections route that is easy to find and quick to act on`,
  },
  {
    slug: "corrections-policy",
    title: "Corrections Policy",
    description: "How to report an error in a DYPOL BLOG article and how we fix mistakes. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

We would rather fix a mistake in the open than pretend it never happened. This page explains how.

## Spotted an error?

Tell us via the [Contact](/contact) page. It helps to include:

- The article's title or web address
- What is wrong, and what it should say
- A source for the correct information, if you have one

You do not need an account, and you do not need to be polite about it — accuracy matters more than pride.

## What we do with reports

- Every report is read by an editor.
- If the report is right, we correct the article **in the text**, as soon as we can. We do not silently swap in a different claim where the change matters.
- Significant corrections — a wrong fact, figure, date or conclusion — are noted at the end of the article with what changed and when.
- Small fixes (a typo, a broken link, a clearer sentence) are made without a note, because noting them would be noise.
- If a story's central claim turns out to be wrong, we will say so at the top of the article, not bury it at the bottom.

## Updates vs corrections

Technology stories develop. When new information genuinely extends a story — a launch date confirmed, a statement issued — we update the article and mark it as updated, with the new date shown. That is an update, not a correction, and the article will make the difference clear.

## If we disagree

Sometimes a reader reports an "error" that is really a difference of interpretation. We will explain our reasoning and the sources behind the article. If your source is stronger, we will change the article — the goal is to be right, not to win.`,
  },
  {
    slug: "contact",
    title: "Contact",
    description: "How to reach the DYPOL BLOG team: tips, corrections, copyright and business enquiries.",
    body: `DYPOL BLOG is published by **DYPOL Labs**. We read everything that reaches the editors, and we reply when a reply is needed.

## News tips

Seen something we should cover — a launch, a leak, research, a scam doing the rounds? Send us:

- What happened, in a sentence or two
- Links to the source (an announcement, listing, paper or post)
- Anything that helps us verify it

Anonymous tips are welcome. We never publish a tip we cannot verify independently.

## Corrections

If something we published is wrong, we want to fix it fast. Send the article address, what is wrong, and the correct information if you have it. Our [Corrections Policy](/corrections-policy) explains exactly what happens next.

## Copyright

For copyright questions, credit changes or takedown notices, see our [DMCA / Copyright Policy](/dmca) — it lists precisely what to include so we can act quickly.

## Advertising and business

For advertising, partnerships and other business enquiries, contact the publisher, DYPOL Labs, referencing DYPOL BLOG and what you have in mind. Editorial coverage is not for sale; see our [Editorial Policy](/editorial-policy).

## Press

Members of the press are welcome to quote our articles with attribution and a link. For anything beyond that, contact the publisher as above.

*DYPOL BLOG does not run reader accounts or a public comment system — the routes above are the fastest way to reach a human.*`,
  },
  {
    slug: "disclaimer",
    title: "Disclaimer",
    description: "What DYPOL BLOG content is — and is not. Reviews, buying advice, affiliate links and accuracy. Effective 18 October 2026.",
    body: `**Effective date: ${EFFECTIVE}**

## General information

DYPOL BLOG publishes technology news, reviews and explainers for general information. We work to be accurate at the time of publication, but technology changes quickly: specifications, prices, availability and company plans can all change after we publish. Check the date on the article, and check the maker's own pages before making a decision.

Nothing on this site is professional advice — financial, legal, medical or otherwise. For decisions that matter, consult someone qualified who knows your situation.

## Reviews and buying advice

Our reviews and buying guides are editorial opinions, based on testing or research described in the article itself. "Best" means best in our judgement, for the readers and uses we describe — it is not a guarantee that a product will suit you, and it is not a promise about future performance or prices.

## Affiliate links

Some links to shops in reviews and buying guides **may** be affiliate links: if you buy through one, the retailer may pay us a small commission at no extra cost to you. Affiliate relationships never decide our verdicts, rankings or recommendations, and a product cannot pay to be recommended. Where an article contains affiliate links, this disclaimer applies to it. Sponsored content, if we ever publish any, will be labelled as sponsored, clearly and in the article itself.

## External content

We link to sources and other websites so you can check our work. We do not control those sites and are not responsible for their content or accuracy.

## Views expressed

Analysis and opinion pieces reflect the judgement of DYPOL BLOG's editors at the time of writing. Facts are sourced; opinions are ours, and we label the difference.

This disclaimer works together with our [Terms and Conditions](/terms) and [Editorial Policy](/editorial-policy).`,
  },
];

export const STANDARD_PAGE_SLUGS = STANDARD_PAGES.map((p) => p.slug);

export function standardPage(slug: string): StandardPage | undefined {
  return STANDARD_PAGES.find((p) => p.slug === slug);
}
