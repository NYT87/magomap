import { LIMITS, type Me } from "@magomap/domain";
import Dexie from "dexie";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ACCOUNT_HEADER, apiFetch, NetworkError, withTimeLimit } from "../api/client";
import { forgetMe, notifyMeChanged } from "../auth/useMe";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  closeUserDb,
  dbName,
  forgetAccountOnDevice,
  openDbOrNull,
  REMOVE_RESULT,
} from "../data/db";
import { accountDeviceKeys } from "../data/deviceKeys";
import { useSyncControls } from "../data/SyncContext";
import { type Lang, setLanguage } from "../i18n";
import { forgetKakaoMapRead } from "../import/kakaoMap";
import { useOnline } from "../import/useOnline";
import { useLayout } from "../layout/useLayout";
import { useMapPrefs } from "../map/mapPrefs";
import type { MapChoice } from "../map/providerChoice";
import { onThemeChange, setTheme, storedTheme, type ThemeChoice } from "../theme";
import { AboutSection } from "./AboutSection";
import { KakaoMapSyncSection } from "./KakaoMapSyncSection";

type Dialog =
  | null
  | { kind: "unsynced"; count: number; rejected: number; everywhere: boolean }
  | { kind: "delete" };

export function Account({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const layout = useLayout();
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

  // The nickname: shown as the card's heading, edited in place.
  const online = useOnline();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState(false);
  const nameErrorId = useId();
  const nameLongId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const editNameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Opening the editor focuses its field; closing it (Save or Cancel) gives focus back to Edit.
  useEffect(() => {
    if (editingName) nameInput.current?.focus();
    else if (wasEditing.current) editNameButton.current?.focus();
    wasEditing.current = editingName;
  }, [editingName]);
  // The limit counts characters as the server does (an emoji is one, not two).
  const nameTooLong = Array.from(nameDraft.trim()).length > LIMITS.nickname;
  const saveName = async () => {
    setSavingName(true);
    setNameError(false);
    try {
      await apiFetch("/api/me", {
        ...forMe("PATCH"),
        body: JSON.stringify({ displayName: nameDraft }),
      });
      setEditingName(false);
      notifyMeChanged();
    } catch {
      setNameError(true);
    } finally {
      setSavingName(false);
    }
  };

  const leave = () => {
    forgetMe();
    // A Kakao Map read kept for a confirmation doesn't outlive the session.
    forgetKakaoMapRead();
    navigate("/signin");
  };

  // "Also remove my data from this device": off by default, never remembered.
  const [removeData, setRemoveData] = useState(false);

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
      if (switched()) return;
      // Removed only when everything reached the server ("Sign out anyway" keeps unsynced data).
      // Otherwise the local database is kept: unsynced changes go out at the next sign-in here.
      if (removeData && !force) {
        // The sign-in screen says how it went (removed, or kept).
        const result = await forgetAccountOnDevice(me.userId);
        // Another account opened while the removal waited (another tab signed in): leave it be.
        if (switched()) return;
        try {
          sessionStorage.setItem(REMOVE_RESULT, result);
        } catch {
          // storage blocked: no message
        }
      }
      leave();
    } catch (e) {
      setError(e instanceof NetworkError ? t("account.signOutOffline") : t("account.failed"));
    } finally {
      setBusy(false);
    }
  };

  // "Download my data": the server answers a JSON file, saved through a temporary link.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const exportHintId = useId();
  const exportErrorId = useId();
  const exportData = async () => {
    setExportError(false);
    setExporting(true);
    try {
      const res = await fetch("/api/me/export", {
        credentials: "same-origin",
        headers: { [ACCOUNT_HEADER]: me.userId },
        // A stalled download ends with "didn't work" instead of spinning forever.
        signal: withTimeLimit(undefined, 120_000),
      });
      if (!res.ok) throw new Error(`export ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `magomap-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/account", forMe("DELETE"));
      // The account is gone: so is what the device remembers for it (its name included).
      for (const key of accountDeviceKeys(me.userId)) {
        try {
          localStorage.removeItem(key);
        } catch {
          // storage blocked: nothing was stored
        }
      }
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
      {layout === "desktop" && <h1 className="mm-screen__title">{t("account.title")}</h1>}
      {/* Only signed-in people see Account: the card just says who it is. */}
      <section className="mm-card mm-stack">
        {editingName ? (
          <form
            className="mm-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameTooLong || savingName) return;
              void saveName();
            }}
          >
            <label className="mm-field">
              <span className="mm-field__label">{t("account.nameLabel")}</span>
              <input
                className="mm-input"
                value={nameDraft}
                // Not cut while typing (that breaks Korean input mid-syllable): Save waits instead.
                onChange={(e) => setNameDraft(e.target.value)}
                aria-describedby={
                  [nameTooLong && nameLongId, nameError && nameErrorId].filter(Boolean).join(" ") ||
                  undefined
                }
                aria-invalid={nameTooLong || undefined}
                ref={nameInput}
              />
            </label>
            {/* Always there, so a screen reader announces the limit the moment it's passed. */}
            <p className={nameTooLong ? "mm-note" : undefined} id={nameLongId} role="status">
              {nameTooLong ? t("account.nameTooLong", { max: LIMITS.nickname }) : ""}
            </p>
            {nameError && (
              <p className="mm-error" role="alert" id={nameErrorId}>
                {t("account.failed")}
              </p>
            )}
            <div className="mm-editor__actions">
              <button
                type="submit"
                className="mm-button mm-button--primary"
                disabled={savingName || nameTooLong}
              >
                {t("account.save")}
              </button>
              <button
                type="button"
                className="mm-button mm-button--secondary"
                onClick={() => setEditingName(false)}
              >
                {t("account.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div className="mm-section__head">
            <h2 className="mm-h4">{me.displayName || t("account.unnamed")}</h2>
            <button
              ref={editNameButton}
              type="button"
              className="mm-button mm-button--secondary"
              disabled={!online}
              onClick={() => {
                setNameDraft(me.displayName ?? "");
                setNameError(false);
                setEditingName(true);
              }}
            >
              {t("account.editName")}
            </button>
          </div>
        )}
      </section>

      <KakaoMapSyncSection me={me} />

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
          disabled={!online || exporting || busy}
          aria-describedby={exportError ? exportErrorId : exportHintId}
          onClick={() => void exportData()}
        >
          {t("account.export")}
        </button>
        <p className="mm-muted" id={exportHintId}>
          {t("account.exportHint")}
        </p>
        {exportError && (
          <p className="mm-error" role="alert" id={exportErrorId}>
            {t("account.exportFailed")}
          </p>
        )}
        <label className="mm-check">
          <input
            type="checkbox"
            checked={removeData}
            disabled={busy}
            onChange={(e) => setRemoveData(e.target.checked)}
          />
          <span>{t("account.removeData")}</span>
        </label>
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
          {removeData && <p>{t("account.removeDataKept")}</p>}
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
