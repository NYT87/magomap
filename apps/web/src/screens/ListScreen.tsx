import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { currentDb } from "../data/db";
import { loadLibrary, SAVED_GROUP, sectionOf, useListPlaces } from "../data/queries";
import { useListArrival } from "../data/useSyncStatus";
import { deleteList, editList } from "../data/writes";
import { DuplicateDialog } from "../lists/DuplicateDialog";
import { ListForm } from "../lists/ListForm";

/** One list's places in order; Kakao lists are read-only, own lists can be edited or deleted. */
export function ListScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const rows = useListPlaces(id);
  const meta = useLiveQuery(async () => {
    const lib = await loadLibrary(currentDb());
    const list = lib.lists.find((l) => l.id === id);
    return list ? { list, section: sectionOf(list, lib.roles) } : null;
  }, [id]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const arrival = useListArrival();
  if (rows === undefined || meta === undefined) return null;
  const saved = id === SAVED_GROUP;
  if (!saved && !meta) return <p className="mm-muted">{t("lists.notFound")}</p>;
  const list = meta?.list;
  const own = meta?.section === "mine";

  return (
    <div className="mm-screen">
      <header className="mm-place__head">
        <h1 className="mm-screen__title">{saved ? t("picker.saved") : list?.name}</h1>
        {list?.ownerName && !own && (
          <p className="mm-muted">{t("picker.by", { name: list.ownerName })}</p>
        )}
        {list && !own && <p className="mm-note">{t("lists.readOnly")}</p>}
        {list && (
          <div className="mm-place__actions">
            {own && (
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setEditing(true)}
              >
                {t("lists.edit")}
              </button>
            )}
            <button
              type="button"
              className="mm-button mm-button--secondary"
              // A Kakao list whose places are still arriving would copy only what is here so far.
              disabled={list.provider != null && arrival != null}
              onClick={() => setDuplicating(true)}
            >
              {t("lists.duplicate.open")}
            </button>
            {own && (
              <button
                type="button"
                className="mm-button mm-button--danger-text"
                onClick={() => setDeleting(true)}
              >
                {t("lists.delete")}
              </button>
            )}
          </div>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="mm-muted">
          {list?.provider != null && arrival
            ? arrival === "unknown"
              ? ""
              : t(arrival === "downloading" ? "lists.downloading" : "lists.downloadWaiting")
            : t("lists.empty")}
        </p>
      ) : (
        <ul className="mm-places__list">
          {rows.map(({ place, item }) => (
            <li key={place.id}>
              <Link
                href={`/places/${encodeURIComponent(place.id)}`}
                className="mm-place-row"
                data-removed={item?.removedAtProvider != null || undefined}
              >
                <span className="mm-place-row__title">{place.title}</span>
                <span className="mm-muted">{place.roadAddress ?? place.address ?? ""}</span>
                {item?.removedAtProvider != null && (
                  <span className="mm-moved-hint">{t("lists.removed")}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {duplicating && list && <DuplicateDialog list={list} onClose={() => setDuplicating(false)} />}
      {editing && list && (
        <ConfirmDialog title={t("lists.edit")} role="dialog" onCancel={() => setEditing(false)}>
          <ListForm
            initial={{ name: list.name, color: list.color }}
            submitLabel={t("lists.save")}
            onCancel={() => setEditing(false)}
            onSubmit={(v) => void editList(list.id, v).then(() => setEditing(false))}
          />
        </ConfirmDialog>
      )}
      {deleting && list && (
        <ConfirmDialog
          title={t("lists.deleteTitle", { name: list.name })}
          onCancel={() => setDeleting(false)}
          actions={
            <>
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setDeleting(false)}
              >
                {t("lists.cancel")}
              </button>
              <button
                type="button"
                className="mm-button mm-button--danger"
                onClick={() => void deleteList(list.id).then(() => navigate("/lists"))}
              >
                {t("lists.delete")}
              </button>
            </>
          }
        >
          <p>{t("lists.deleteBody")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
