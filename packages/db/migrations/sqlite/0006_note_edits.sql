-- When the owner last changed a Kakao list item's note from magomap (after Kakao Map took it),
-- so a Kakao read older than the edit never puts the old note back. Null: never edited here.
ALTER TABLE list_items ADD COLUMN note_edited_at INTEGER;
