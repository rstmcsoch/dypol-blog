-- t147: dominant colour of an opaque cover, painted behind the <img> while
-- its bytes load. NULL = unknown or transparent image (no placeholder).
alter table media add column dominant_color text;
