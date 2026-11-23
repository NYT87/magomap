-- A colour on an own-list item: the Kakao colour code (two digits, as Kakao Map's favourites
-- carry) of the place it was copied from, so a copy of a Kakao list keeps each place's colour.
-- Null for Kakao list items (they have provider_color) and for items with no colour.
ALTER TABLE list_items ADD COLUMN item_color TEXT;
