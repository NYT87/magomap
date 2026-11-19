import { ArrowLeft, Download, List, Map as MapIcon, UserRound } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useLayout } from "./useLayout";

export const SEARCH_INPUT_ID = "mm-search";

interface Props {
  /** The map; stays mounted on every route. */
  map: ReactNode;
  /** The routed page (ignored at "/" on phones, where the map is the page). */
  children: ReactNode;
  /** Shown in the header on every screen (the sync indicator). */
  status?: ReactNode;
}

const NAV = [
  { href: "/", key: "nav.map", Icon: MapIcon },
  { href: "/lists", key: "nav.lists", Icon: List },
  { href: "/import", key: "nav.import", Icon: Download },
  { href: "/account", key: "nav.account", Icon: UserRound },
] as const;

function Nav({ current }: { current: string }) {
  const { t } = useTranslation();
  return (
    <nav className="mm-nav" aria-label={t("nav.menu")}>
      {NAV.map(({ href, key, Icon }) => {
        const active = href === "/" ? current === "/" : current.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className="mm-nav__item"
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden size={22} strokeWidth={1.75} />
            <span>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: full-screen map, pages over it with back. Desktop: a side panel beside the map. */
export function AppLayout({ map, children, status }: Props) {
  const layout = useLayout();
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const atRoot = location === "/";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
      if (e.key === "/" && !typing) {
        const search = document.getElementById(SEARCH_INPUT_ID);
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
      if (e.key === "Escape" && layout === "desktop" && location.startsWith("/places/")) {
        navigate("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, location, navigate]);

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/");
  };

  if (layout === "desktop") {
    return (
      <div className="mm-shell mm-shell--desktop">
        <aside className="mm-panel">
          <header className="mm-panel__header">
            <Link href="/" className="mm-wordmark">
              <img src="/icons/favicon.svg" alt="" width={28} height={28} />
              <span>{t("app.name")}</span>
            </Link>
            {status}
          </header>
          <Nav current={location} />
          <div className="mm-panel__body">{children}</div>
        </aside>
        <main className="mm-map">{map}</main>
      </div>
    );
  }

  return (
    <div className="mm-shell mm-shell--phone">
      <main className="mm-map" aria-hidden={atRoot ? undefined : true}>
        {map}
      </main>
      {atRoot ? (
        <>
          <div className="mm-phone-status">{status}</div>
          <Nav current={location} />
        </>
      ) : (
        <section className="mm-page">
          <header className="mm-page__header">
            <button type="button" className="mm-icon-button" onClick={back}>
              <ArrowLeft aria-hidden size={22} strokeWidth={1.75} />
              <span className="mm-visually-hidden">{t("nav.back")}</span>
            </button>
            {status}
          </header>
          <div className="mm-page__body">{children}</div>
        </section>
      )}
    </div>
  );
}
