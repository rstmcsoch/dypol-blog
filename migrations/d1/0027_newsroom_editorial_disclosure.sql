-- t179: clarify the newsroom's use of AI-assisted tools without describing the publication as AI-written.
-- The newsroom leads story selection and editorial decisions; AI tools may support research,
-- trend discovery, analytics and early draft preparation. Outputs must be checked against sources.

UPDATE pages
SET body = REPLACE(body, '## How our stories are produced

DYPOL BLOG uses modern tools, and we are open about it. Our articles are researched and drafted with the help of AI systems, then **reviewed and approved by a human editor before anything is published**. Every story must be based on sources we can point to — you will find them listed at the end of each article. If a claim cannot be verified, it does not go in. You can read more in our [Editorial Policy](/editorial-policy).', '## How our newsroom works

Our writers and editors guide DYPOL BLOG''s coverage. The newsroom selects stories, sets the angle, develops the reporting and takes responsibility for the articles it publishes.

We use AI-assisted tools in a supporting role across parts of the editorial workflow. They can help us spot emerging topics and trends, find background material and potential sources, organise research, assist with preliminary fact-finding, and analyse audience and publication data. In some workflows, they may also help prepare or refine an early working draft. AI output is treated as working material, not as evidence: important names, dates, figures, quotations and technical claims are checked against original documents, official statements, research papers or other reliable sources. Editorial judgement and responsibility for the finished article remain with our team. Read more in our [Editorial Policy](/editorial-policy).'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'about'
  AND instr(body, 'Our articles are researched and drafted with the help of AI systems') > 0;

UPDATE pages
SET body = REPLACE(
      REPLACE(body, '## How stories are researched and written

We are open about our process: **articles are researched and drafted with the help of AI systems, working from real sources, and every article is reviewed and approved by a human editor before it is published.**', '## How stories are researched and written

Our editorial team sets coverage priorities, chooses the angle and directs each assignment. Writers develop and prepare stories; editors review the sourcing, accuracy, clarity and context before publication. The newsroom remains responsible for the work published under DYPOL BLOG''s name.

AI-assisted tools support selected parts of this process. They may help monitor emerging topics and trends, locate potential sources and background material, organise research, assist with preliminary fact-finding, analyse audience and publication data, and prepare or refine early drafts. Their output is working material — not a source of truth, proof or an independent fact-check. Important details, including names, dates, figures, quotations and technical claims, are checked against original documents, official statements, research papers or other reliable sources. Unsupported claims are removed or clearly qualified.'),
      'The AI never publishes on its own. A human being is responsible for every story on this site, and our [Corrections Policy](/corrections-policy) applies when we fall short.', 'Editorial judgement, publication decisions and responsibility for corrections remain with DYPOL BLOG''s editorial team. AI tools assist the workflow; they do not replace newsroom standards or accountability. Our [Corrections Policy](/corrections-policy) explains how we address mistakes.'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'editorial-policy'
  AND instr(body, 'articles are researched and drafted with the help of AI systems') > 0;

UPDATE pages
SET body = REPLACE(body, '**Effective date: 18 October 2026**', '**Effective date: 24 November 2026**'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'editorial-policy'
  AND instr(body, '**Effective date: 18 October 2026**') > 0;

UPDATE pages
SET body = REPLACE(
      REPLACE(body, '**Effective date: 18 October 2026**', '**Effective date: 24 November 2026**'),
      '## External links',
      '## Editorial tools and AI assistance

Our newsroom may use AI-assisted tools to support trend monitoring, preliminary research, source discovery, data analysis and parts of draft preparation. Their output is not treated as authoritative and does not replace source verification or editorial judgement. Our [Editorial Policy](/editorial-policy) explains the standards that apply to our published work.

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

DYPOL BLOG may use AI-assisted tools to support topic discovery, trend monitoring, preliminary research, source organisation, data analysis and parts of draft preparation. These tools can produce incomplete or inaccurate results; their output is not a substitute for original sources or editorial review. Material claims are checked against appropriate source material under our [Editorial Policy](/editorial-policy).

## External content'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'disclaimer'
  AND instr(body, '## Editorial research and AI-assisted tools') = 0;
