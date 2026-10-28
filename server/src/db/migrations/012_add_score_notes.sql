-- A note attached to a score cell. A cell may have a note without a value
-- (for example "absent"), so "has content" now means value OR comment present.
ALTER TABLE evaluations ADD COLUMN comment text;

ALTER TABLE evaluations ADD CONSTRAINT evaluation_comment_length
  CHECK (comment IS NULL OR char_length(comment) <= 500);
