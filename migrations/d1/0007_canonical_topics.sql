-- 0007: canonical topics (t44).
-- One article can now be filed under several topics. Topics stay in the
-- `categories` table (the admin Topics page manages them); the new join
-- table carries every topic, and articles.category_id remains the PRIMARY
-- (first) topic so existing single-topic displays keep working.
-- Existing articles are preserved: their old category maps to the closest
-- canonical topic (legacy map below), anything unknown falls back to
-- 'tech-news'. The old default tags are removed with their links.

create table if not exists article_topics (
  article_id text not null references articles (id) on delete cascade,
  category_id text not null references categories (id),
  primary key (article_id, category_id)
);

create index if not exists article_topics_category_idx on article_topics (category_id);

-- The canonical 25 topics.
insert or ignore into categories (id, slug, label, description) values
  ('artificial-intelligence-ai-tools', 'artificial-intelligence-ai-tools', 'Artificial Intelligence & AI Tools', 'AI models, assistants, agents and the tools built on them.'),
  ('smartphones-android-iphone-wearables', 'smartphones-android-iphone-wearables', 'Smartphones, Android, iPhone & Wearables', 'Phones, tablets, watches and the platforms they run.'),
  ('apps-software-operating-systems', 'apps-software-operating-systems', 'Apps, Software & Operating Systems', 'Applications, operating systems and everyday software.'),
  ('cybersecurity-privacy', 'cybersecurity-privacy', 'Cybersecurity, Privacy', 'Security threats, breaches, privacy and staying safe online.'),
  ('online-scams', 'online-scams', 'Online Scams', 'Fraud, phishing and scams people meet online, and how to spot them.'),
  ('big-tech-companies', 'big-tech-companies', 'Big Tech Companies', 'The largest technology companies and what they do next.'),
  ('competition', 'competition', 'Competition', 'Rivalries, market races and antitrust between tech companies.'),
  ('computer-hardware', 'computer-hardware', 'Computer Hardware', 'Computers, components, peripherals and how they are built.'),
  ('chips-gaming', 'chips-gaming', 'Chips & Gaming', 'Processors, graphics and the games industry.'),
  ('startups', 'startups', 'Startups', 'New companies, founders and early-stage technology.'),
  ('funding-tech-business', 'funding-tech-business', 'Funding & Tech Business', 'Investment, earnings, deals and the business of tech.'),
  ('social-media', 'social-media', 'Social Media', 'Social platforms, creators and online communities.'),
  ('youtube-internet-culture', 'youtube-internet-culture', 'YouTube & Internet Culture', 'Video, streaming, memes and how the internet lives.'),
  ('emerging-technology', 'emerging-technology', 'Emerging Technology', 'New technology that is still finding its shape.'),
  ('robotics-science', 'robotics-science', 'Robotics & Science', 'Robots, automation and the science behind them.'),
  ('technology-policy', 'technology-policy', 'Technology Policy', 'Laws, regulation and government decisions about technology.'),
  ('cloud-computing-data-centers-enterprise-tech', 'cloud-computing-data-centers-enterprise-tech', 'Cloud Computing, Data Centers & Enterprise Tech', 'Cloud platforms, data centers and technology at work.'),
  ('electric-vehicles', 'electric-vehicles', 'Electric Vehicles', 'Electric cars, batteries and charging.'),
  ('smart-mobility-clean-technology', 'smart-mobility-clean-technology', 'Smart Mobility & Clean Technology', 'New ways to move, and cleaner technology.'),
  ('product-reviews', 'product-reviews', 'Product Reviews', 'Hands-on reviews and verdicts on tech products.'),
  ('buying-guides', 'buying-guides', 'Buying Guides', 'What to buy, what to skip, and how to choose.'),
  ('developer-tools', 'developer-tools', 'Developer Tools', 'Tools, services and platforms for building software.'),
  ('coding-open-source', 'coding-open-source', 'Coding & Open Source', 'Programming, open source projects and developer life.'),
  ('tech-news', 'tech-news', 'Tech News', 'General technology news that fits nowhere else.'),
  ('leaks', 'leaks', 'Leaks', 'Credible leaks, rumours and early looks at unreleased tech.');

-- File every existing article under its mapped topic.
insert or ignore into article_topics (article_id, category_id)
select id, case
    when category_id in ('ai', 'artificial-intelligence') then 'artificial-intelligence-ai-tools'
    when category_id = 'systems' then 'developer-tools'
    when category_id in ('design', 'publishing', 'notes') then 'tech-news'
    when category_id in ('artificial-intelligence-ai-tools', 'smartphones-android-iphone-wearables', 'apps-software-operating-systems', 'cybersecurity-privacy', 'online-scams', 'big-tech-companies', 'competition', 'computer-hardware', 'chips-gaming', 'startups', 'funding-tech-business', 'social-media', 'youtube-internet-culture', 'emerging-technology', 'robotics-science', 'technology-policy', 'cloud-computing-data-centers-enterprise-tech', 'electric-vehicles', 'smart-mobility-clean-technology', 'product-reviews', 'buying-guides', 'developer-tools', 'coding-open-source', 'tech-news', 'leaks') then category_id
    else 'tech-news'
  end
from articles;

-- Keep the primary column in step with the mapping.
update articles set category_id = case
    when category_id in ('ai', 'artificial-intelligence') then 'artificial-intelligence-ai-tools'
    when category_id = 'systems' then 'developer-tools'
    when category_id in ('design', 'publishing', 'notes') then 'tech-news'
    when category_id in ('artificial-intelligence-ai-tools', 'smartphones-android-iphone-wearables', 'apps-software-operating-systems', 'cybersecurity-privacy', 'online-scams', 'big-tech-companies', 'competition', 'computer-hardware', 'chips-gaming', 'startups', 'funding-tech-business', 'social-media', 'youtube-internet-culture', 'emerging-technology', 'robotics-science', 'technology-policy', 'cloud-computing-data-centers-enterprise-tech', 'electric-vehicles', 'smart-mobility-clean-technology', 'product-reviews', 'buying-guides', 'developer-tools', 'coding-open-source', 'tech-news', 'leaks') then category_id
    else 'tech-news'
  end;

-- Remove the old default tags (structure/type/layout/media/workflow/index)
-- and their links. Owner-created tags are untouched.
delete from article_tags where tag_id in ('structure', 'type', 'layout', 'media', 'workflow', 'index');
delete from tags where id in ('structure', 'type', 'layout', 'media', 'workflow', 'index');

-- Remove the old default topics; only the canonical list (plus anything the
-- owner adds later) remains.
delete from categories where slug not in ('artificial-intelligence-ai-tools', 'smartphones-android-iphone-wearables', 'apps-software-operating-systems', 'cybersecurity-privacy', 'online-scams', 'big-tech-companies', 'competition', 'computer-hardware', 'chips-gaming', 'startups', 'funding-tech-business', 'social-media', 'youtube-internet-culture', 'emerging-technology', 'robotics-science', 'technology-policy', 'cloud-computing-data-centers-enterprise-tech', 'electric-vehicles', 'smart-mobility-clean-technology', 'product-reviews', 'buying-guides', 'developer-tools', 'coding-open-source', 'tech-news', 'leaks');
