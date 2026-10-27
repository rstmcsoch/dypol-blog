-- t120: normalize the publication brand across settings and saved standard pages.
-- Keep this data-only migration narrow: do not touch articles, URLs, IDs, or other content.
UPDATE site_settings
SET data = replace(data, 'DYPOL Blog', 'DYPOL BLOG')
WHERE instr(data, 'DYPOL Blog') > 0;

UPDATE pages
SET
  title = replace(title, 'DYPOL Blog', 'DYPOL BLOG'),
  body = replace(body, 'DYPOL Blog', 'DYPOL BLOG'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE instr(title, 'DYPOL Blog') > 0
   OR instr(body, 'DYPOL Blog') > 0;
