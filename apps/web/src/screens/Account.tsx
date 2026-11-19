import type { Me } from "@magomap/domain";
import Dexie from "dexie";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { apiFetch, NetworkError } from "../api/client";
import { forgetMe } from "../auth/useMe";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useSyncControls } from "../data/SyncContext";
import { type Lang, setLanguage } from "../i18n";

type Dialog =
  | null
  | { kind: "unsynced"; count: number; rejected: number; everywhere: boolean }
  | { kind: "delete" };

export function Account({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const sync = useSyncControls();
  const [, navigate] = useLocation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = t("account.deleteWord");

  const leave = () => {
    forgetMe();
    navigate("/signin");
  };

  const signOut = async (everywhere: boolean, force = false) => {
    setError(null);
    if (!force && (sync.unsynced > 0 || sync.rejected > 0)) {
      setBusy(true);
      if (sync.unsynced > 0) await sync.syncNow().catch(() => {});
      const left = sync.countUnsynced ? await sync.countUnsynced() : sync.unsynced;
      setBusy(false);
      if (left > 0 || sync.rejected > 0) {
        setDialog({ kind: "unsynced", count: left, rejected: sync.rejected, everywhere });
        return;
      }
    }
    try {
      setBusy(true);
      await apiFetch(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST" });
      // The local database is kept: unsynced changes go out at the next sign-in here.
      leave();
    } catch (e) {
      setError(e instanceof NetworkError ? t("account.signOutOffline") : t("account.failed"));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/account", { method: "DELETE" });
      await Dexie.delete(`magomap-${me.userId}`);
      leave();
    } catch {
      setError(t("account.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mm-screen">
      <h1 className="mm-screen__title">{t("account.title")}</h1>
      <section className="mm-card">
        <p className="mm-strong">
          {me.displayName ? t("account.signedInAs", { name: me.displayName }) : t("account.noName")}
        </p>
        <p className="mm-muted">{t("account.kakao")}</p>
        <p className="mm-muted">{t("account.linkGoogle")}</p>
      </section>

      <section className="mm-card">
        <label className="mm-field">
          <span className="mm-field__label">{t("account.language")}</span>
          <select
            className="mm-input"
            value={i18n.language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
          >
            <option value="ko" lang="ko">
              한국어
            </option>
            <option value="en" lang="en">
              English
            </option>
          </select>
        </label>
      </section>

      <section className="mm-stack">
        <button
          type="button"
          className="mm-button mm-button--secondary"
          disabled={busy}
          onClick={() => void signOut(false)}
        >
          {t("account.signOut")}
        </button>
        <button
          type="button"
          className="mm-button mm-button--tertiary"
          disabled={busy}
          onClick={() => void signOut(true)}
        >
          {t("account.signOutEverywhere")}
        </button>
        <button
          type="button"
          className="mm-button mm-button--danger-text"
          disabled={busy}
          onClick={() => {
            setTyped("");
            setDialog({ kind: "delete" });
          }}
        >
          {t("account.deleteAccount")}
        </button>
        {error && (
          <p className="mm-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {dialog?.kind === "unsynced" && (
        <ConfirmDialog
          title={t("account.unsyncedTitle")}
          onCancel={() => setDialog(null)}
          actions={
            <>
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setDialog(null)}
              >
                {t("account.cancel")}
              </button>
              <button
                type="button"
                className="mm-button mm-button--primary"
                onClick={() => {
                  const everywhere = dialog.everywhere;
                  setDialog(null);
                  void signOut(everywhere, true);
                }}
              >
                {t("account.signOutAnyway")}
              </button>
            </>
          }
        >
          {dialog.count > 0 && <p>{t("account.unsyncedBody", { count: dialog.count })}</p>}
          {dialog.rejected > 0 && <p>{t("account.rejectedNote", { count: dialog.rejected })}</p>}
        </ConfirmDialog>
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("account.deleteTitle")}
          onCancel={() => setDialog(null)}
          actions={
            <>
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setDialog(null)}
              >
                {t("account.cancel")}
              </button>
              <button
                type="button"
                className="mm-button mm-button--danger"
                disabled={typed.trim() !== word || busy}
                onClick={() => void deleteAccount()}
              >
                {t("account.deleteConfirm")}
              </button>
            </>
          }
        >
          <p>{t("account.deleteBody")}</p>
          {sync.unsynced > 0 && (
            <p className="mm-strong">{t("account.deleteUnsynced", { count: sync.unsynced })}</p>
          )}
          <label className="mm-field">
            <span className="mm-field__label">{t("account.deletePrompt", { word })}</span>
            <input
              className="mm-input"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
