import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentDb } from "../data/db";
import { loadLibrary, sectionOf, usePlaceMemberships } from "../data/queries";
import { addToList, removeFromList } from "../data/writes";
import { membershipColor } from "../map/markers";
import { kakaoNoteOf } from "./kakaoNotes";

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
  if (!memberships || !ownLists) return null;
  const inList = new Set(memberships.map((m) => m.list.id));
  const addable = ownLists.filter((l) => !inList.has(l.id));

  return (
    <section className="mm-section" aria-labelledby="lists-title">
      <h2 id="lists-title" className="mm-section__title">
        {t("place.lists")}
      </h2>
      {memberships.length === 0 && <p className="mm-muted">{t("place.noLists")}</p>}
      <ul className="mm-memberships">
        {memberships.map(({ item, list, section }) => {
          const note = kakaoNoteOf(item);
          const color = membershipColor(item, list);
          return (
            <li key={item.id} className="mm-membership">
              <div className="mm-chip" data-removed={item.removedAtProvider != null || undefined}>
                <span className="mm-swatch" style={{ background: color }} aria-hidden />
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
              </div>
              {note && (
                <figure
                  className="mm-kakao-note"
                  aria-label={`${t("place.kakaoNote")}: ${list.name}`}
                  style={{ "--note-color": color } as CSSProperties}
                >
                  <p className="mm-kakao-note__text">{note}</p>
                  {/* Only the list's owner can change its note; a list she follows says nothing. */}
                  {section === "provider" && (
                    <p className="mm-muted mm-kakao-note__hint">{t("place.kakaoNoteReadOnly")}</p>
                  )}
                </figure>
              )}
            </li>
          );
        })}
      </ul>
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
