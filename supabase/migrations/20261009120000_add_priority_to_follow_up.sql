-- Add priority column to follow_up_items table
-- Priority levels: 1 (critical/highest) to 5 (minimal/lowest)
-- Default: 3 (normal) for new records and existing records without explicit priority

ALTER TABLE follow_up_items
ADD COLUMN priority INTEGER NOT NULL DEFAULT 3
CHECK (priority >= 1 AND priority <= 5);
