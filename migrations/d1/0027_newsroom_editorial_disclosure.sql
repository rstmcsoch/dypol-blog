-- t179: clarify the newsroom's human-led writing process and supporting use of AI tools.
-- This migration changes only AI-related passages on reader-facing pages.
-- The database is checked for the old copy so re-running it does not overwrite later edits.

UPDATE pages
SET body = REPLACE(body, '## How our stories are produced

DYPOL BLOG uses modern tools, and we are open about it. Our articles are researched and drafted with the help of AI systems, then **reviewed and approved by a human editor before anything is published**. Every story must be based on sources we can point to — you will find them listed at the end of each article. If a claim cannot be verified, it does not go in. You can read more in our [Editorial Policy](/editorial-policy).', '## How our newsroom works

Our writers and editors lead DYPOL BLOG''s coverage and do the main work of producing its articles. As a general guide, our writers contribute roughly 80% of an article''s written content; the exact contribution can vary by story.

AI-assisted tools support the team with surface-level research, finding background information and potential sources, spotting emerging topics and trends, and analysing site traffic and audience activity to suggest what readers may find useful. For serious, complex or original-reporting stories that require deeper research or human input, our writers and editors carry out that work, check primary sources and apply their own expertise and editorial judgement. The team remains responsible for the substance and final wording of its articles. Read more in our [Editorial Policy](/editorial-policy).'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'about'
  AND instr(body, 'Our articles are researched and drafted with the help of AI systems') > 0;

UPDATE pages
SET body = REPLACE(
      REPLACE(body, 'We are open about our process: **articles are researched and drafted with the help of AI systems, working from real sources, and every article is reviewed and approved by a human editor before it is published.**', 'Our writers lead the reporting and do most of the writing. As a general guide, our team members produce roughly 80% of an article''s written content; the exact contribution varies by story. Editors set coverage priorities, choose the angle and ensure that published work meets the publication''s standards.

AI-assisted tools support the team with surface-level research, finding background information and potential sources, spotting emerging topics and trends, and analysing site traffic and audience activity to suggest what readers may find useful. For serious, complex or original-reporting stories that require deeper research or human input, our writers and editors carry out that work, check primary sources and add the expertise, context and judgement the story needs. AI suggestions are starting points, not a substitute for the team''s research or verification.'),
      'The AI never publishes on its own. A human being is responsible for every story on this site, and our [Corrections Policy](/corrections-policy) applies when we fall short.', 'Writers and editors remain responsible for each article''s substance, accuracy and final wording. AI is a supporting tool; it does not replace the team''s reporting, deeper research or editorial judgement. Our [Corrections Policy](/corrections-policy) explains how we address mistakes.'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'editorial-policy'
  AND instr(body, 'articles are researched and drafted with the help of AI systems') > 0;

UPDATE pages
SET body = REPLACE(
      REPLACE(body, '**Effective date: 18 October 2026**', '**Effective date: 24 November 2026**'),
      '## External links',
      '## Editorial tools and AI assistance

AI-assisted tools may support our newsroom with surface-level research, background and source discovery, trend monitoring, and analysis of site traffic and audience activity. Our writers produce roughly 80% of article text as a general guide, while our team carries out deeper research and applies human expertise where a story requires it. See our [Editorial Policy](/editorial-policy) for details.

## External links'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug IN ('terms', 'terms-and-conditions')
  AND instr(body, '## Editorial tools and AI assistance') = 0;

UPDATE pages
SET body = REPLACE(
      REPLACE(body, '**Effective date: 18 October 2026**', '**Effective date: 24 November 2026**'),
      '## External content',
      '## Editorial research and AI-assisted tools

AI-assisted tools help our team with surface-level research, background and source discovery, trend monitoring, and analysis of site traffic and audience activity. Our writers produce roughly 80% of article text as a general guide. For serious or complex stories, our team carries out the deeper research, checks primary sources and applies human expertise and editorial judgement. AI output can be incomplete or inaccurate and is not a substitute for verification. See our [Editorial Policy](/editorial-policy).

## External content'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'disclaimer'
  AND instr(body, '## Editorial research and AI-assisted tools') = 0;

UPDATE pages
SET body = REPLACE(body, '**Effective date: 18 October 2026**', '**Effective date: 24 November 2026**'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'editorial-policy'
  AND instr(body, '**Effective date: 18 October 2026**') > 0;
