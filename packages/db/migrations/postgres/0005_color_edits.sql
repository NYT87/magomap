-- When the owner last changed a Kakao list item's colour from magomap (after Kakao Map took it),
-- so a Kakao read older than the edit never puts the old colour back. Null: never edited here.
ALTER TABLE list_items ADD COLUMN color_edited_at BIGINT;
