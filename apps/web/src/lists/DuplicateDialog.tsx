import type { ListRow } from "@magomap/domain";
import { LIMITS } from "@magomap/domain/limits";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { duplicateList } from "../data/writes";
import { detectExtension } from "../import/kakaoMap";
import { duplicateToKakao, KakaoCopyError, type KakaoCopyResult } from "./duplicateToKakao";

/** "<name> (copy)", with the name clipped so the whole fits the list name limit. */
function defaultCopyName(t: (key: string, o: { name: string }) => string, name: string): string {
  const chars = [...name];
  let full = t("lists.duplicate.defaultName", { name });
  while (full.length > LIMITS.listName && chars.length > 0) {
    chars.pop();
    full = t("lists.duplicate.defaultName", { name: chars.join("") });
  }
  return full;
}

/** Where a copy to Kakao Map stands. */
type KakaoState =
  | { kind: "idle" }
  | { kind: "copying" }
  | { kind: "done"; result: KakaoCopyResult }
  | { kind: "failed"; code: string; folderId?: number; added?: number; atLeast?: boolean };

const errorKey = (code: string) =>
  ({
    extension_missing: "lists.duplicate.errExtension",
    account_mismatch: "lists.duplicate.errAccount",
    account_unconfirmed: "lists.duplicate.errUnconfirmed",
    kakao_signed_out: "lists.duplicate.errSignedOut",
    busy: "lists.duplicate.errBusy",
    offline: "lists.duplicate.errOffline",
    partial: "lists.duplicate.errPartial",
    list_missing: "lists.duplicate.errListMissing",
  })[code] ?? "lists.duplicate.errUnavailable";

/** A stopped copy's message: the count when it's known, a lower bound, or none at all. */
const failedKey = (state: Extract<KakaoState, { kind: "failed" }>) => {
  if (state.code !== "partial" || !state.atLeast) return errorKey(state.code);
  return (state.added ?? 0) > 0
    ? "lists.duplicate.errPartialAtLeast"
    : "lists.duplicate.errPartialUnknown";
};

/** Names a copy of `list` and makes it as a new own list in magomap, then opens it. */
export function DuplicateDialog({ list, onClose }: { list: ListRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [name, setName] = useState(() => defaultCopyName(t, list.name));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A second tap before the first finishes must not make a second list.
  const working = useRef(false);
  const nameId = useId();
  const blank = !name.trim();
  const isKakao = list.provider === "kakao";
  const [extension, setExtension] = useState<"checking" | "ready" | "missing">("checking");
  const [kakao, setKakao] = useState<KakaoState>({ kind: "idle" });
  const kakaoWorking = useRef(false);
  // The Kakao list a stopped copy made: kept until a copy finishes, so every retry fills it.
  const resumeFolder = useRef<number | undefined>(undefined);
  const copying = kakao.kind === "copying";
  // The copy button is disabled while copying, which drops focus. When the copy finishes, that
  // button is gone and Close takes focus; when it stops, focus returns to it (now "Try again").
  const closeRef = useRef<HTMLButtonElement>(null);
  const kakaoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (kakao.kind === "done") closeRef.current?.focus();
    if (kakao.kind === "failed") kakaoRef.current?.focus();
  }, [kakao]);

  // Copying to Kakao Map is offered only where the extension answers.
  useEffect(() => {
    if (!isKakao) return;
    let live = true;
    void detectExtension().then((state) => {
      if (live) setExtension(state);
    });
    return () => {
      live = false;
    };
  }, [isKakao]);

  const copyToKakao = () => {
    if (kakaoWorking.current || working.current || blank) return;
    kakaoWorking.current = true;
    const resume = resumeFolder.current;
    setKakao({ kind: "copying" });
    duplicateToKakao({
      sourceListId: list.id,
      name,
      ...(resume === undefined ? {} : { resume: { folderId: resume } }),
    }).then(
      (result) => {
        kakaoWorking.current = false;
        resumeFolder.current = undefined;
        setKakao({ kind: "done", result });
      },
      (error) => {
        kakaoWorking.current = false;
        if (error instanceof KakaoCopyError && error.folderId !== undefined) {
          resumeFolder.current = error.folderId;
        }
        // The list it was filling is gone (or isn't hers): the next try makes a new one.
        if (error instanceof KakaoCopyError && error.code === "list_missing") {
          resumeFolder.current = undefined;
        }
        setKakao(
          error instanceof KakaoCopyError
            ? {
                kind: "failed",
                code: error.code,
                ...(error.folderId === undefined ? {} : { folderId: error.folderId }),
                ...(error.added === undefined ? {} : { added: error.added }),
                ...(error.atLeast ? { atLeast: true } : {}),
              }
            : { kind: "failed", code: "kakao_unavailable" },
        );
      },
    );
  };

  const copy = () => {
    if (working.current || blank) return;
    working.current = true;
    setBusy(true);
    setFailed(false);
    duplicateList(list.id, name).then(
      (id) => {
        navigate(`/lists/${encodeURIComponent(id)}`);
        onClose();
      },
      () => {
        working.current = false;
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <ConfirmDialog
      title={t("lists.duplicate.title", { name: list.name })}
      role="dialog"
      onCancel={onClose}
      actions={
        kakao.kind === "done" ? (
          <button
            ref={closeRef}
            type="button"
            className="mm-button mm-button--primary"
            onClick={onClose}
          >
            {t("lists.duplicate.close")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="mm-button mm-button--secondary"
              disabled={copying}
              onClick={onClose}
            >
              {t("lists.duplicate.cancel")}
            </button>
            {isKakao && extension === "ready" && (
              <button
                ref={kakaoRef}
                type="button"
                className="mm-button mm-button--primary"
                disabled={blank || busy || copying}
                onClick={copyToKakao}
              >
                {kakao.kind === "failed" || resumeFolder.current !== undefined
                  ? t("lists.duplicate.tryAgain")
                  : t("lists.duplicate.copyKakao")}
              </button>
            )}
            <button
              type="button"
              className="mm-button mm-button--primary"
              disabled={blank || busy || copying}
              onClick={copy}
            >
              {t("lists.duplicate.copyHere")}
            </button>
          </>
        )
      }
    >
      <div className="mm-stack">
        <label className="mm-field" htmlFor={nameId}>
          <span className="mm-field__label">{t("lists.duplicate.name")}</span>
        </label>
        <input
          id={nameId}
          className="mm-input"
          value={name}
          maxLength={LIMITS.listName}
          disabled={copying || kakao.kind === "done"}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              copy();
            }
          }}
        />
        {isKakao && extension === "missing" && (
          <p className="mm-muted">{t("lists.duplicate.needsExtension")}</p>
        )}
        <p role="status" className="mm-muted">
          {copying ? t("lists.duplicate.copying") : ""}
        </p>
        {kakao.kind === "done" && (
          <div role="status" className="mm-stack">
            <p>{t("lists.duplicate.resultAdded", { count: kakao.result.added })}</p>
            {kakao.result.leftOut > 0 && (
              <p className="mm-muted">
                {t("lists.duplicate.resultLeftOut", { count: kakao.result.leftOut })}
              </p>
            )}
            {!kakao.result.synced && <p>{t("lists.duplicate.resultNotSynced")}</p>}
          </div>
        )}
        {kakao.kind === "failed" && (
          <p role="alert" className="mm-error">
            {t(failedKey(kakao), { count: kakao.added ?? 0 })}
          </p>
        )}
        {failed && (
          <p role="alert" className="mm-error">
            {t("lists.duplicate.failed")}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
