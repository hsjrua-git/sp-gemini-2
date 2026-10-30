-- The audit log is filtered two ways (see routes/audit.js): by actor name
-- (case-insensitively) and by category (the part of the action before the first
-- dot). Both are expression filters, so plain column indexes don't help them.
-- These functional indexes keep those filters fast as the log grows instead of
-- degrading to a sequential scan.
CREATE INDEX audit_log_actor_lower_idx ON audit_log (lower(actor));

CREATE INDEX audit_log_category_idx ON audit_log (split_part(action, '.', 1));
