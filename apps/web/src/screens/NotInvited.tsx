import { useTranslation } from "react-i18next";
import { Link } from "wouter";

export function NotInvited() {
  const { t } = useTranslation();
  return (
    <main className="mm-welcome">
      <div className="mm-welcome__inner">
        <img src="/icons/favicon.svg" alt="" width={64} height={64} className="mm-welcome__mark" />
        <h1 className="mm-welcome__title">{t("notInvited.title")}</h1>
        <p className="mm-welcome__lead">{t("notInvited.body")}</p>
        <Link href="/signin" className="mm-button mm-button--secondary mm-button--wide">
          {t("notInvited.back")}
        </Link>
      </div>
    </main>
  );
}
