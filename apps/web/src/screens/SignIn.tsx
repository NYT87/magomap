import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useConfig } from "../auth/useConfig";

export function SignIn() {
  const { t } = useTranslation();
  const config = useConfig();
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);

  const devLogin = async (e: FormEvent) => {
    e.preventDefault();
    setFailed(false);
    try {
      await apiFetch("/api/auth/dev", {
        method: "POST",
        body: JSON.stringify({ kakaoUserId: userId.trim(), nickname: name.trim() || undefined }),
      });
      window.location.assign("/");
    } catch {
      setFailed(true);
    }
  };

  return (
    <main className="mm-welcome">
      <div className="mm-welcome__inner">
        <img src="/icons/favicon.svg" alt="" width={64} height={64} className="mm-welcome__mark" />
        <h1 className="mm-welcome__title">{t("signin.title")}</h1>
        <p className="mm-welcome__lead">{t("signin.lead")}</p>
        <a className="mm-button mm-button--primary mm-button--wide" href="/api/auth/kakao/start">
          {t("signin.kakao")}
        </a>
        {/* Another person on this device: Kakao would otherwise reuse the browser's Kakao login. */}
        <a className="mm-link-button mm-welcome__alt" href="/api/auth/kakao/start?account=other">
          {t("signin.otherAccount")}
        </a>
        {config?.devLoginEnabled && (
          <form className="mm-card mm-stack" onSubmit={devLogin}>
            <h2 className="mm-h4">{t("signin.devTitle")}</h2>
            <label className="mm-field">
              <span className="mm-field__label">{t("signin.devUser")}</span>
              <input
                className="mm-input"
                value={userId}
                required
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>
            <label className="mm-field">
              <span className="mm-field__label">{t("signin.devName")}</span>
              <input className="mm-input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="mm-button mm-button--secondary">
              {t("signin.devSubmit")}
            </button>
            {failed && (
              <p className="mm-error" role="alert">
                {t("signin.devFailed")}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
