-- Image bytes are not stored in Postgres. They belong in the MEDIA R2 bucket,
-- with the row kept in D1. Drop the blob column added before that binding was wired.
alter table media drop column if exists bytes;
