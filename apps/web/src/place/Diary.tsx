import type { VisitNoteRow } from "@magomap/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { locationAt, usePlaceLocations, usePlaceNotes, visitMoment } from "../data/queries";
import { deleteVisitNote } from "../data/writes";
import { formatDate } from "../i18n";
import { NoteEditor } from "./NoteEditor";
import { useSyncMarks } from "./syncMarks";

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="mm-link-button"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        )
      }
    >
      {done ? t("place.copied") : t("place.copy")}
    </button>
  );
}

function Entry({
  note,
  oldAddress,
  pending,
  refused,
  onEdit,
  onDelete,
}: {
  note: VisitNoteRow;
  oldAddress: string | null;
  pending: boolean;
  refused: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const imported = note.origin === "import";
  const when = note.visitedOn
    ? formatDate(visitMoment(note.visitedOn))
    : imported
      ? t("place.fromKakaoList")
      : t("place.noDate");
  return (
    <article className="mm-entry">
      <header className="mm-entry__head">
        {note.visitedOn ? (
          <time className="mm-entry__date" dateTime={note.visitedOn}>
            {formatDate(visitMoment(note.visitedOn))}
          </time>
        ) : imported ? (
          <span className="mm-badge mm-badge--quiet">{t("place.fromKakaoList")}</span>
        ) : (
          <span className="mm-entry__date">{t("place.noDate")}</span>
        )}
        {oldAddress && (
          <span className="mm-entry__where">{t("place.atOld", { address: oldAddress })}</span>
        )}
      </header>
      <p className="mm-entry__body">{note.body}</p>
      <footer className="mm-entry__foot">
        {refused ? (
          <span className="mm-entry__state mm-entry__state--error">
            {t("place.notSaved")} <CopyButton text={note.body} />
          </span>
        ) : pending ? (
          <span className="mm-entry__state">{t("place.notSynced")}</span>
        ) : (
          <span />
        )}
        <span className="mm-entry__actions">
          <button
            type="button"
            className="mm-link-button"
            onClick={onEdit}
            aria-label={t("place.editNote", { date: when })}
          >
            {t("place.edit")}
          </button>
          <button
            type="button"
            className="mm-link-button mm-link-button--danger"
            onClick={onDelete}
            aria-label={t("place.deleteNote", { date: when })}
          >
            {t("place.delete")}
          </button>
        </span>
      </footer>
    </article>
  );
}

/** The visit diary: newest first, with where each visit happened if the place has moved. */
export function Diary({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const notes = usePlaceNotes(placeId);
  const locations = usePlaceLocations(placeId) ?? [];
  const marks = useSyncMarks("visit_notes");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<VisitNoteRow | null>(null);

  const oldAddress = (note: VisitNoteRow) => {
    const at = note.visitedOn ? visitMoment(note.visitedOn) : note.createdAt;
    const loc = locationAt(locations, at);
    return loc ? (loc.roadAddress ?? loc.address ?? t("place.unknownAddress")) : null;
  };

  return (
    <section className="mm-section" aria-labelledby="diary-title">
      <div className="mm-section__head">
        <h2 id="diary-title" className="mm-section__title">
          {t("place.diary")}
        </h2>
        {editing !== "new" && (
          <button
            type="button"
            className="mm-button mm-button--primary"
            onClick={() => setEditing("new")}
          >
            {t("place.addNote")}
          </button>
        )}
      </div>
      {editing === "new" && <NoteEditor placeId={placeId} onDone={() => setEditing(null)} />}
      {notes && notes.length === 0 && editing !== "new" && (
        <p className="mm-muted">{t("place.emptyDiary")}</p>
      )}
      <div className="mm-diary">
        {notes?.map((note) =>
          editing === note.id ? (
            <NoteEditor
              key={note.id}
              placeId={placeId}
              note={note}
              onDone={() => setEditing(null)}
            />
          ) : (
            <Entry
              key={note.id}
              note={note}
              oldAddress={oldAddress(note)}
              pending={marks.pending.has(note.id)}
              refused={marks.refused.has(note.id)}
              onEdit={() => setEditing(note.id)}
              onDelete={() => setDeleting(note)}
            />
          ),
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={t("place.deleteNoteTitle")}
          onCancel={() => setDeleting(null)}
          actions={
            <>
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setDeleting(null)}
              >
                {t("place.cancel")}
              </button>
              <button
                type="button"
                className="mm-button mm-button--danger"
                onClick={() => {
                  void deleteVisitNote(deleting.id);
                  setDeleting(null);
                }}
              >
                {t("place.delete")}
              </button>
            </>
          }
        >
          <p>{t("place.deleteNoteBody")}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
