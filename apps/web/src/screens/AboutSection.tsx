import type { BuildInfo } from "@magomap/domain";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { checkForUpdate, useAppUpdate } from "../update/useAppUpdate";
import { APP_BUILD, useServerBuild } from "../version";

/** The time of a build, or null when missing or not a date. */
function builtTime(build: BuildInfo): number | null {
  if (!build.builtAt) return null;
  const time = new Date(build.builtAt).getTime();
  return Number.isNaN(time) ? null : time;
}

function BuildRow({ label, build }: { label: string; build: BuildInfo }) {
  const { t, i18n } = useTranslation();
  const time = builtTime(build);
  const date =
    time === null
      ? null
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
          time,
        );
  return (
    <div className="mm-about__line">
      <dt className="mm-about__label">{label}</dt>
      <dd className="mm-about__what">
        <code className="mm-about__value">{`${build.version} · ${build.commit}`}</code>
        {date && <span className="mm-muted">{t("about.built", { date })}</span>}
      </dd>
    </div>
  );
}

/** Which version the app and the server are; `children` is the room for an update button. */
export function AboutSection({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const server = useServerBuild();
  const { waiting, update } = useAppUpdate();
  let note: string | null = null;
  if (
    server.state === "ok" &&
    server.build.commit !== "unknown" &&
    APP_BUILD.commit !== "unknown" &&
    server.build.commit !== APP_BUILD.commit
  ) {
    const app = builtTime(APP_BUILD);
    const theirs = builtTime(server.build);
    note =
      app !== null && theirs !== null && app < theirs ? t("about.mismatch") : t("about.differs");
  }
  const differs = note !== null;
  // The Update button only shows once the worker found the new version: look when Account opens,
  // and again as soon as the server is seen on another version.
  useEffect(() => {
    checkForUpdate();
  }, []);
  useEffect(() => {
    if (differs) checkForUpdate();
  }, [differs]);
  return (
    <section className="mm-card mm-about" aria-labelledby="mm-about-title">
      <h2 className="mm-h4" id="mm-about-title">
        {t("about.title")}
      </h2>
      <dl className="mm-about__list">
        <BuildRow label={t("about.app")} build={APP_BUILD} />
      </dl>
      {/* Always there, so what arrives after the fetch is announced. */}
      <div role="status" className="mm-about__status">
        {server.state === "ok" && (
          <dl className="mm-about__list">
            <BuildRow label={t("about.server")} build={server.build} />
          </dl>
        )}
        {server.state === "offline" && <p className="mm-muted">{t("about.offline")}</p>}
        {note && <p className="mm-note">{note}</p>}
      </div>
      {waiting && (
        <button
          type="button"
          className="mm-button mm-button--primary mm-about__update"
          onClick={() => void update()}
        >
          {t("update.now")}
        </button>
      )}
      {children}
    </section>
  );
}
