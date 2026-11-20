import type { Me } from "@magomap/domain";
import Dexie from "dexie";
import { useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ACCOUNT_HEADER, apiFetch, NetworkError } from "../api/client";
import { forgetMe } from "../auth/useMe";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { closeUserDb, dbName, openDbOrNull } from "../data/db";
import { useSyncControls } from "../data/SyncContext";
import { type Lang, setLanguage } from "../i18n";
import { ImportSection } from "../import/ImportSection";
import { useMapPrefs } from "../map/mapPrefs";
import type { MapChoice } from "../map/providerChoice";
import { onThemeChange, setTheme, storedTheme, type ThemeChoice } from "../theme";
import { AboutSection } from "./AboutSection";

type Dialog =
  | null
  | { kind: "unsynced"; count: number; rejected: number; everywhere: boolean }
  | { kind: "delete" };

export function Account({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const { mapChoice, setMapChoice, kakaoAvailable } = useMapPrefs();
  const mapHintId = useId();
  const sync = useSyncControls();
  const [, navigate] = useLocation();
  // Follows this tab and other tabs (followTheme applies the change itself).
  const theme = useSyncExternalStore(onThemeChange, storedTheme);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = t("account.deleteWord");

  // Every request here acts for the account this screen shows, never one opened meanwhile.
  const forMe = (method: string) => ({ method, headers: { [ACCOUNT_HEADER]: me.userId } });

  const leave = () => {
    forgetMe();
    navigate("/signin");
  };

  const signOut = async (everywhere: boolean, force = false) => {
    setError(null);
    // Another account opened while waiting (another tab signed in): this screen is gone. A fresh
    // database for the same account (its old one deleted elsewhere) is still this account.
    const opened = openDbOrNull()?.name;
    const switched = () => {
      const now = openDbOrNull()?.name;
      return now !== undefined && now !== opened;
    };
    if (!force && (sync.unsynced > 0 || sync.rejected > 0)) {
      setBusy(true);
      if (sync.unsynced > 0) await sync.syncNow().catch(() => {});
      const left = sync.countUnsynced
        ? await sync.countUnsynced().catch(() => sync.unsynced)
        : sync.unsynced;
      setBusy(false);
      if (switched()) return;
      if (left > 0 || sync.rejected > 0) {
        setDialog({ kind: "unsynced", count: left, rejected: sync.rejected, everywhere });
        return;
      }
    }
    try {
      setBusy(true);
      await apiFetch(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", forMe("POST"));
      // The local database is kept: unsynced changes go out at the next sign-in here.
      if (!switched()) leave();
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
      await apiFetch("/api/account", forMe("DELETE"));
      // Close this account's database first, so nothing (a sync, a live query) recreates it.
      closeUserDb(me.userId);
      await Dexie.delete(dbName(me.userId));
      // If another account opened meanwhile (even during the deletion), it stays on its own page.
      if (openDbOrNull() === null) leave();
    } catch {
      setError(t("account.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mm-screen mm-account">
      <h1 className="mm-screen__title">{t("account.title")}</h1>
      {/* Only signed-in people see Account: the card just says who it is. */}
      <section className="mm-card">
        <h2 className="mm-h4">{me.displayName || t("account.unnamed")}</h2>
      </section>

      <ImportSection />

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
        <label className="mm-field">
          <span className="mm-field__label">{t("account.theme")}</span>
          <select
            className="mm-input"
            value={theme}
            onChange={(e) => {
              setTheme(e.target.value as ThemeChoice);
            }}
          >
            <option value="system">{t("account.themeSystem")}</option>
            <option value="light">{t("account.themeLight")}</option>
            <option value="dark">{t("account.themeDark")}</option>
          </select>
        </label>
        <label className="mm-field">
          <span className="mm-field__label">{t("account.map")}</span>
          <select
            className="mm-input"
            value={mapChoice}
            aria-describedby={mapHintId}
            onChange={(e) => setMapChoice(e.target.value as MapChoice)}
          >
            <option value="auto">{t("account.mapAuto")}</option>
            <option value="kakao">{t("account.mapKakao")}</option>
            <option value="osm">{t("account.mapOsm")}</option>
          </select>
        </label>
        <p className="mm-muted" id={mapHintId}>
          {t("account.mapHint")}
        </p>
        {kakaoAvailable === false && <p className="mm-note">{t("account.mapKakaoUnavailable")}</p>}
      </section>

      <AboutSection />

      <section className="mm-stack mm-account-actions">
        <button
          type="button"
          className="mm-button mm-button--secondary mm-button--wide"
          disabled={busy}
          onClick={() => void signOut(false)}
        >
          {t("account.signOut")}
        </button>
        <button
          type="button"
          className="mm-button mm-button--secondary mm-button--wide"
          disabled={busy}
          onClick={() => void signOut(true)}
        >
          {t("account.signOutEverywhere")}
        </button>
        <button
          type="button"
          className="mm-button mm-button--danger-outline mm-button--wide"
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
