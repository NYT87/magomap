import { useLiveQuery } from "dexie-react-hooks";
import { Palette, Plus, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentDb } from "../data/db";
import { loadLibrary, sectionOf, usePlaceMemberships } from "../data/queries";
import { addToList, createList, removeFromList } from "../data/writes";
import { detectExtension } from "../import/kakaoMap";
import { membershipColor } from "../map/markers";
import { ColorPicker } from "./ColorPicker";
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
  const [open, setOpen] = useState(false);
  // The membership whose colour is being changed, and whether the extension (Kakao lists) answers.
  const [coloring, setColoring] = useState<string | null>(null);
  const [extension, setExtension] = useState<"checking" | "ready" | "missing">("checking");
  useEffect(() => {
    let live = true;
    void detectExtension().then((state) => {
      if (live) setExtension(state);
    });
    return () => {
      live = false;
    };
  }, []);
  const [newName, setNewName] = useState("");
  const panelId = useId();
  const nameId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setNewName("");
    addButton.current?.focus();
  };
  if (!memberships || !ownLists) return null;
  const inList = new Set(memberships.map((m) => m.list.id));
  const addable = ownLists.filter((l) => !inList.has(l.id));

  return (
    <section className="mm-section" aria-labelledby="lists-title">
      <div className="mm-section__head">
        <h2 id="lists-title" className="mm-section__title">
          {t("place.lists")}
        </h2>
        <button
          ref={addButton}
          type="button"
          className="mm-icon-button"
          aria-label={t("place.addToList")}
          title={t("place.addToList")}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) close();
          }}
        >
          <Plus aria-hidden size={20} strokeWidth={1.75} />
        </button>
      </div>
      {open && (
        // A labelled group; Escape closes it and returns focus to the icon.
        <fieldset
          id={panelId}
          className="mm-card mm-add-list"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <legend className="mm-visually-hidden">{t("place.addToList")}</legend>
          {addable.length > 0 && (
            <ul className="mm-add-list__items">
              {addable.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="mm-add-list__option"
                    onClick={() => void addToList(l.id, placeId).then(close)}
                  >
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {ownLists.length > 0 && addable.length === 0 && (
            <p className="mm-muted">{t("place.inAllLists")}</p>
          )}
          <form
            className="mm-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              void createList({ name, color: null })
                .then((id) => addToList(id, placeId))
                .then(close);
            }}
          >
            <label htmlFor={nameId} className="mm-visually-hidden">
              {t("place.newListName")}
            </label>
            <input
              id={nameId}
              className="mm-input"
              value={newName}
              placeholder={t("place.newListName")}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              type="submit"
              className="mm-button mm-button--secondary"
              disabled={!newName.trim()}
            >
              {t("place.createAndAdd")}
            </button>
          </form>
        </fieldset>
      )}
      {memberships.length === 0 && <p className="mm-muted">{t("place.noLists")}</p>}
      {extension === "missing" && memberships.some((m) => m.section === "provider") && (
        <p className="mm-muted">{t("place.color.needsExtension")}</p>
      )}
      <ul className="mm-memberships">
        {memberships.map(({ item, list, section }) => {
          const note = kakaoNoteOf(item);
          const color = membershipColor(item, list);
          // His own lists, and Kakao lists he owns (changed in Kakao Map first, so it needs the extension).
          const canColor =
            item.removedAtProvider == null && (section === "mine" || section === "provider");
          const colorReady = section === "mine" || extension === "ready";
          const currentColor =
            (section === "mine" ? item.itemColor : item.providerColor) ?? undefined;
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
                {canColor && (
                  <button
                    type="button"
                    className="mm-icon-button"
                    aria-label={t("place.color.change", { name: list.name })}
                    title={t("place.color.change", { name: list.name })}
                    aria-expanded={coloring === item.id}
                    disabled={!colorReady}
                    onClick={() => setColoring(coloring === item.id ? null : item.id)}
                  >
                    <Palette aria-hidden size={18} strokeWidth={1.75} />
                  </button>
                )}
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
              {canColor && coloring === item.id && (
                <ColorPicker
                  itemId={item.id}
                  listName={list.name}
                  current={currentColor}
                  onDone={() => setColoring(null)}
                />
              )}
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
    </section>
  );
}
