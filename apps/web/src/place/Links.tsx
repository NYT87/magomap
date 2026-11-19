import type { LinkRow } from "@magomap/domain";
import { httpUrl } from "@magomap/domain";
import { ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { usePlaceLinks } from "../data/queries";
import { addLink, deleteLink, editLink } from "../data/writes";
import { useSyncMarks } from "./syncMarks";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function LinkForm({
  link,
  onDone,
  placeId,
}: {
  link?: LinkRow;
  placeId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(link?.url ?? "");
  const [title, setTitle] = useState(link?.title ?? "");
  const [bad, setBad] = useState(false);
  const urlId = useId();
  const titleId = useId();
  const save = async () => {
    if (!httpUrl.safeParse(url.trim()).success) {
      setBad(true);
      return;
    }
    const value = { url: url.trim(), title: title.trim() || null };
    if (link) await editLink(link.id, value);
    else await addLink(placeId, value);
    onDone();
  };
  return (
    <form
      className="mm-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="mm-field" htmlFor={urlId}>
        <span className="mm-field__label">{t("place.url")}</span>
      </label>
      <input
        id={urlId}
        className="mm-input"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={url}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setBad(false);
          setUrl(e.target.value);
        }}
      />
      {bad && (
        <p className="mm-error" role="alert">
          {t("place.badUrl")}
        </p>
      )}
      <label className="mm-field" htmlFor={titleId}>
        <span className="mm-field__label">{t("place.linkTitle")}</span>
      </label>
      <input
        id={titleId}
        className="mm-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="mm-editor__actions">
        <button type="button" className="mm-button mm-button--tertiary" onClick={onDone}>
          {t("place.cancel")}
        </button>
        <button type="submit" className="mm-button mm-button--primary" disabled={!url.trim()}>
          {t("place.saveLink")}
        </button>
      </div>
    </form>
  );
}

/** Links about the place: reviews, menus, posts. Each opens in a new tab. */
export function Links({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const links = usePlaceLinks(placeId);
  const marks = useSyncMarks("links");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<LinkRow | null>(null);
  return (
    <section className="mm-section" aria-labelledby="links-title">
      <div className="mm-section__head">
        <h2 id="links-title" className="mm-section__title">
          {t("place.links")}
        </h2>
        {editing !== "new" && (
          <button
            type="button"
            className="mm-button mm-button--secondary"
            onClick={() => setEditing("new")}
          >
            {t("place.addLink")}
          </button>
        )}
      </div>
      {editing === "new" && <LinkForm placeId={placeId} onDone={() => setEditing(null)} />}
      {links && links.length === 0 && editing !== "new" && (
        <p className="mm-muted">{t("place.emptyLinks")}</p>
      )}
      <ul className="mm-links">
        {links?.map((link) =>
          editing === link.id ? (
            <li key={link.id}>
              <LinkForm placeId={placeId} link={link} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={link.id} className="mm-link-row">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mm-link-row__main"
              >
                <span className="mm-link-row__title">{link.title || host(link.url)}</span>
                <span className="mm-muted">{host(link.url)}</span>
                <span className="mm-visually-hidden">{t("place.newTab")}</span>
                <ExternalLink
                  aria-hidden
                  size={16}
                  strokeWidth={1.75}
                  className="mm-link-row__icon"
                />
              </a>
              <span className="mm-entry__actions">
                {marks.refused.has(link.id) ? (
                  <span className="mm-entry__state mm-entry__state--error">
                    {t("place.notSaved")}
                  </span>
                ) : (
                  marks.pending.has(link.id) && (
                    <span className="mm-entry__state">{t("place.notSynced")}</span>
                  )
                )}
                <button
                  type="button"
                  className="mm-link-button"
                  onClick={() => setEditing(link.id)}
                  aria-label={t("place.editLink", { name: link.title || host(link.url) })}
                >
                  {t("place.edit")}
                </button>
                <button
                  type="button"
                  className="mm-link-button mm-link-button--danger"
                  onClick={() => setDeleting(link)}
                  aria-label={t("place.deleteLink", { name: link.title || host(link.url) })}
                >
                  {t("place.delete")}
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
      {deleting && (
        <ConfirmDialog
          title={t("place.deleteLinkTitle")}
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
                  void deleteLink(deleting.id);
                  setDeleting(null);
                }}
              >
                {t("place.delete")}
              </button>
            </>
          }
        >
          <p>{deleting.title || deleting.url}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
