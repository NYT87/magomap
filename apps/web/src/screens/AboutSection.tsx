import type { BuildInfo } from "@magomap/domain";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { APP_BUILD, useServerBuild } from "../version";

function BuildLine({ label, build }: { label: string; build: BuildInfo }) {
  const { t, i18n } = useTranslation();
  const date = build.builtAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(build.builtAt),
      )
    : null;
  return (
    <p className="mm-about__line">
      <span className="mm-about__label">{label}</span>
      <span className="mm-about__what">
        <code className="mm-about__value">{`${build.version} · ${build.commit}`}</code>
        {date && <span className="mm-muted">{t("about.built", { date })}</span>}
      </span>
    </p>
  );
}

/** Which version the app and the server are; `children` is the room for an update button. */
export function AboutSection({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const server = useServerBuild();
  const older =
    server.state === "ok" &&
    server.build.commit !== "unknown" &&
    APP_BUILD.commit !== "unknown" &&
    server.build.commit !== APP_BUILD.commit;
  return (
    <section className="mm-card mm-about" aria-labelledby="mm-about-title">
      <h2 className="mm-h4" id="mm-about-title">
        {t("about.title")}
      </h2>
      <BuildLine label={t("about.app")} build={APP_BUILD} />
      {server.state === "ok" && <BuildLine label={t("about.server")} build={server.build} />}
      {server.state === "offline" && <p className="mm-muted">{t("about.offline")}</p>}
      {older && <p className="mm-note">{t("about.mismatch")}</p>}
      {children}
    </section>
  );
}
