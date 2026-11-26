import { Palette, Pencil, Plus, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentDb } from "../data/db";
import { kakaoListsFor, sectionOf, useLibrary, usePlaceMemberships } from "../data/queries";
import {
  addToKakaoList,
  addToList,
  createList,
  removeFromList,
  removeKakaoAdd,
} from "../data/writes";
import { detectExtension } from "../import/kakaoMap";
import { membershipColor } from "../map/markers";
import { ColorPicker } from "./ColorPicker";
import { KakaoNoteEditor } from "./KakaoNoteEditor";
import { kakaoNoteOf } from "./kakaoNotes";

/** The lists this place is in. Kakao lists are read-only; own lists can be added to or left. */
export function Memberships({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const memberships = usePlaceMemberships(placeId);
  const lib = useLibrary();
  const ownLists = useMemo(
    () =>
      lib?.lists
        .filter((l) => sectionOf(l, lib.roles) === "mine")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lib],
  );
  // Her own Kakao lists this place can be added to in Kakao Map.
  const kakaoLists = useMemo(() => (lib ? kakaoListsFor(lib, placeId) : undefined), [lib, placeId]);
  const [open, setOpen] = useState(false);
  // The membership whose colour is being changed, and whether the extension (Kakao lists) answers.
  const [coloring, setColoring] = useState<string | null>(null);
  // The membership whose Kakao note is being edited.
  const [editingNote, setEditingNote] = useState<string | null>(null);
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
  const chipsRef = useRef<HTMLUListElement>(null);
  // What screen readers hear about her Kakao adds (added, cancelled, in Kakao Map, failed).
  const [said, setSaid] = useState("");
  const close = () => {
    setOpen(false);
    setNewName("");
    addButton.current?.focus();
  };
  // A pending add that went into Kakao Map, or failed, is said once.
  const pendingBefore = useRef<Map<string, { name: string; failed: string | null }> | null>(null);
  useEffect(() => {
    if (!memberships) return;
    const now = new Map(
      memberships.flatMap((m) =>
        m.pending ? [[m.pending.id, { name: m.list.name, failed: m.pending.failed }] as const] : [],
      ),
    );
    const before = pendingBefore.current;
    pendingBefore.current = now;
    if (!before) return;
    for (const [id, was] of before) {
      const is = now.get(id);
      const inKakao = !is && memberships.some((m) => !m.pending && m.list.name === was.name);
      if (inKakao) setSaid(t("place.pendingDone", { name: was.name }));
      else if (is?.failed && is.failed !== was.failed) {
        setSaid(
          `${was.name}: ${t(is.failed === "list_missing" ? "place.pendingListMissing" : "place.pendingCantSend")}`,
        );
      }
    }
  }, [memberships, t]);
  /** After a chip goes, focus moves to the chip that takes its place, or to Add to list. */
  const focusAfterRemoving = (index: number) =>
    requestAnimationFrame(() => {
      const chips = [...(chipsRef.current?.children ?? [])];
      const next = chips[Math.min(index, chips.length - 1)]?.querySelector<HTMLElement>("button");
      (next ?? addButton.current)?.focus();
    });
  if (!memberships || !ownLists || !kakaoLists) return null;
  const inList = new Set(memberships.map((m) => m.list.id));
  const addable = ownLists.filter((l) => !inList.has(l.id));
  const kakaoAddable = kakaoLists.filter((l) => !inList.has(l.id));
  const addToKakao = (listId: string, name: string) => {
    // Closed at once, so a second tap can't ask twice.
    close();
    const db = currentDb();
    void addToKakaoList(listId, placeId).then(() => {
      setSaid(t("place.pendingAdded", { name }));
      // Unless this browser surely has no extension, try now (the push checks for it itself).
      if (extension !== "missing") {
        void import("../lists/pushKakaoAdds").then(({ pushKakaoAdds }) => pushKakaoAdds(db));
      }
    });
  };
  const waiting = memberships.some((m) => m.pending && m.pending.failed == null);

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
          {ownLists.length > 0 && addable.length === 0 && kakaoAddable.length === 0 && (
            <p className="mm-muted">{t("place.inAllLists")}</p>
          )}
          {kakaoAddable.length > 0 && (
            <fieldset className="mm-add-list__group">
              <legend className="mm-add-list__heading">{t("place.kakaoListsGroup")}</legend>
              <ul className="mm-add-list__items">
                {kakaoAddable.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="mm-add-list__option"
                      onClick={() => addToKakao(l.id, l.name)}
                    >
                      {l.name}
                    </button>
                  </li>
                ))}
              </ul>
              {/* Said once: beside the lists instead, while adds are already waiting. */}
              {extension === "missing" && !waiting && (
                <p className="mm-muted mm-add-list__note">{t("place.kakaoAddLater")}</p>
              )}
            </fieldset>
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
      {waiting && extension === "missing" && <p className="mm-muted">{t("place.kakaoAddLater")}</p>}
      <p role="status" className="mm-visually-hidden">
        {said}
      </p>
      <ul className="mm-memberships" ref={chipsRef}>
        {memberships.map(({ item, list, section, pending }, index) => {
          const note = kakaoNoteOf(item);
          const color = membershipColor(item, list);
          // His own lists, and Kakao lists he owns (changed in Kakao Map first, so it needs the extension).
          // Not for a place only waiting to be added in Kakao Map: there's no favourite to change yet.
          const canColor =
            pending === undefined &&
            item.removedAtProvider == null &&
            (section === "mine" || section === "provider");
          const colorReady = section === "mine" || extension === "ready";
          const currentColor =
            (section === "mine" ? item.itemColor : item.providerColor) ?? undefined;
          // The note of a Kakao list he owns: changed in Kakao Map first, so it needs the extension.
          const isOwned =
            pending === undefined && section === "provider" && item.removedAtProvider == null;
          const noteReady = extension === "ready";
          const canEditNote = isOwned && noteReady;
          return (
            <li key={item.id} className="mm-membership">
              <div className="mm-chip" data-removed={item.removedAtProvider != null || undefined}>
                <span className="mm-swatch" style={{ background: color }} aria-hidden />
                <span className="mm-chip__text">
                  <span className="mm-chip__name">{list.name}</span>
                  {item.removedAtProvider != null && (
                    <span className="mm-chip__meta">{t("place.removedFromKakao")}</span>
                  )}
                  {pending && (
                    <span
                      id={`pending-${item.id}`}
                      className="mm-chip__meta"
                      data-failed={pending.failed != null || undefined}
                    >
                      {pending.failed === "list_missing"
                        ? `${t("place.pendingListMissing")} ${t("place.pendingTapX")}`
                        : pending.failed === "cant_send"
                          ? `${t("place.pendingCantSend")} ${t("place.pendingTapX")}`
                          : t("place.pendingKakao")}
                    </span>
                  )}
                </span>
                {pending && (
                  <button
                    type="button"
                    className="mm-icon-button mm-chip__remove"
                    aria-label={t("place.pendingRemove", { name: list.name })}
                    aria-describedby={`pending-${item.id}`}
                    onClick={() =>
                      void removeKakaoAdd(pending.id).then(() => {
                        setSaid(t("place.pendingCancelled", { name: list.name }));
                        focusAfterRemoving(index);
                      })
                    }
                  >
                    <X aria-hidden size={18} strokeWidth={1.75} />
                  </button>
                )}
                {canColor && (
                  <button
                    type="button"
                    className="mm-icon-button"
                    id={`color-button-${item.id}`}
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
                    onClick={() =>
                      void removeFromList(item.id).then(() => focusAfterRemoving(index))
                    }
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
                  onDone={() => {
                    setColoring(null);
                    // The picker is gone: keep the keyboard user where they were.
                    requestAnimationFrame(() =>
                      document.getElementById(`color-button-${item.id}`)?.focus(),
                    );
                  }}
                />
              )}
              {editingNote === item.id && canEditNote ? (
                <KakaoNoteEditor
                  itemId={item.id}
                  listName={list.name}
                  current={item.providerNote?.trim() ?? ""}
                  onDone={() => {
                    setEditingNote(null);
                    // The box is gone: keep the keyboard user where they were.
                    requestAnimationFrame(() =>
                      document.getElementById(`note-button-${item.id}`)?.focus(),
                    );
                  }}
                />
              ) : (
                <>
                  {note && (
                    <figure
                      className="mm-kakao-note"
                      aria-label={`${t("place.kakaoNote")}: ${list.name}`}
                      style={{ "--note-color": color } as CSSProperties}
                    >
                      <p className="mm-kakao-note__text">{note}</p>
                      {/* Only the list's owner can change its note; a list she follows says nothing. */}
                      {section === "provider" && !canEditNote && (
                        <p className="mm-muted mm-kakao-note__hint">
                          {t("place.kakaoNoteReadOnly")}
                        </p>
                      )}
                    </figure>
                  )}
                  {canEditNote && (
                    <button
                      type="button"
                      className="mm-button mm-button--secondary mm-note-edit"
                      id={`note-button-${item.id}`}
                      aria-label={t("place.kakaoNoteEdit.edit", { name: list.name })}
                      onClick={() => setEditingNote(item.id)}
                    >
                      <Pencil aria-hidden size={16} strokeWidth={1.75} />
                      {note ? t("place.kakaoNoteEdit.editShort") : t("place.kakaoNoteEdit.add")}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
