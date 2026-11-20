import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentDb } from "../data/db";
import { loadLibrary, sectionOf, usePlaceMemberships } from "../data/queries";
import { addToList, removeFromList } from "../data/writes";
import { membershipColor } from "../map/markers";
import { groupKakaoNotes } from "./kakaoNotes";

/** The lists this place is in. Kakao lists are read-only; own lists can be added to or left. */
export function Memberships({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const memberships = usePlaceMemberships(placeId);
  const ownLists = useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    return lib.lists
      .filter((l) => sectionOf(l, lib.roles) === "mine")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);
  const [choice, setChoice] = useState("");
  const selectId = useId();
  const notesId = useId();
  if (!memberships || !ownLists) return null;
  const notes = groupKakaoNotes(memberships);
  const inList = new Set(memberships.map((m) => m.list.id));
  const addable = ownLists.filter((l) => !inList.has(l.id));

  return (
    <section className="mm-section" aria-labelledby="lists-title">
      <h2 id="lists-title" className="mm-section__title">
        {t("place.lists")}
      </h2>
      {memberships.length === 0 && <p className="mm-muted">{t("place.noLists")}</p>}
      <ul className="mm-chips">
        {memberships.map(({ item, list, section }) => (
          <li
            key={item.id}
            className="mm-chip"
            data-removed={item.removedAtProvider != null || undefined}
          >
            <span
              className="mm-swatch"
              style={{ background: membershipColor(item, list) }}
              aria-hidden
            />
            <span className="mm-chip__text">
              <span className="mm-chip__name">{list.name}</span>
              {item.removedAtProvider != null && (
                <span className="mm-chip__meta">{t("place.removedFromKakao")}</span>
              )}
            </span>
            {section === "mine" && (
              <button
                type="button"
                className="mm-icon-button mm-chip__remove"
                aria-label={t("place.removeFrom", { name: list.name })}
                onClick={() => void removeFromList(item.id)}
              >
                <X aria-hidden size={18} strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <section className="mm-kakao-notes" aria-labelledby={notesId}>
          <h3 id={notesId} className="mm-kakao-notes__title">
            {t("place.kakaoNotes")}
          </h3>
          {notes.map((note) => {
            const names = note.from
              .map((f) => (f.removed ? `${f.name} ${t("place.removedSuffix")}` : f.name))
              .join(" · ");
            return (
              <figure
                key={note.text}
                className="mm-card mm-kakao-note"
                aria-label={`${t("place.kakaoNote")}: ${names}`}
                style={{ "--note-color": note.from[0]?.color } as CSSProperties}
              >
                <figcaption className="mm-kakao-note__from">
                  {note.from.map((f) => (
                    <span key={f.listId} className="mm-kakao-note__list">
                      <span className="mm-swatch" style={{ background: f.color }} aria-hidden />
                      {f.name}
                      {f.removed && ` ${t("place.removedSuffix")}`}
                    </span>
                  ))}
                </figcaption>
                <p className="mm-kakao-note__text">{note.text}</p>
                <p className="mm-muted mm-kakao-note__hint">{t("place.kakaoNoteReadOnly")}</p>
              </figure>
            );
          })}
        </section>
      )}
      {ownLists.length === 0 ? (
        <p className="mm-muted">{t("place.noOwnLists")}</p>
      ) : (
        addable.length > 0 && (
          <form
            className="mm-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (choice) void addToList(choice, placeId).then(() => setChoice(""));
            }}
          >
            <label htmlFor={selectId} className="mm-visually-hidden">
              {t("place.addToList")}
            </label>
            <select
              id={selectId}
              className="mm-input"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">{t("place.chooseList")}</option>
              {addable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="submit" className="mm-button mm-button--secondary" disabled={!choice}>
              {t("place.add")}
            </button>
          </form>
        )
      )}
    </section>
  );
}
