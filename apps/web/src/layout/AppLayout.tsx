import { ArrowLeft, List, Map as MapIcon, UserRound } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useLayout } from "./useLayout";

export const SEARCH_INPUT_ID = "mm-search";

interface Props {
  /** The map; stays mounted on every route. */
  map: ReactNode;
  /** The routed page (ignored at "/" on phones, where the map is the page). */
  children: ReactNode;
  /** The sync indicator: in the header on desktop and on phone pages (the map has its own). */
  status?: ReactNode;
  /** A notice that stays mounted: under the status on desktop, under the header on phone pages,
   *  and where the map renders `<NoticeSlot />` on the phone map. */
  notice?: ReactNode;
}

const NoticeContext = createContext<ReactNode>(null);

/** Where the phone map shows the layout's notice (in its notes above the nav). */
export function NoticeSlot() {
  return <>{useContext(NoticeContext)}</>;
}

const NAV = [
  { href: "/", key: "nav.map", Icon: MapIcon },
  { href: "/lists", key: "nav.lists", Icon: List },
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
export function AppLayout({ map, children, status, notice }: Props) {
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

  // The window title follows the screen; on phones, focus moves to the new page's heading.
  useEffect(() => {
    const section = location.split("/")[1] ?? "";
    const key = { lists: "nav.lists", account: "nav.account" }[section];
    document.title = key ? `${t(key)} – ${t("app.name")}` : t("app.name");
  }, [location, t]);
  const page = useRef<HTMLElement>(null);
  useEffect(() => {
    if (layout !== "phone" || location === "/") return;
    const heading = page.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [layout, location]);

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
            <div className="mm-status">
              {status}
              {notice}
            </div>
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
      {/* One map element throughout (no remount); hidden from everyone while a page covers it. */}
      <main className="mm-map" hidden={!atRoot}>
        <NoticeContext.Provider value={atRoot ? notice : null}>{map}</NoticeContext.Provider>
      </main>
      {atRoot ? (
        <Nav current={location} />
      ) : (
        <main className="mm-page" ref={page}>
          <header className="mm-page__header">
            <button type="button" className="mm-icon-button" onClick={back}>
              <ArrowLeft aria-hidden size={22} strokeWidth={1.75} />
              <span className="mm-visually-hidden">{t("nav.back")}</span>
            </button>
            {status}
          </header>
          <div className="mm-page__notice">{notice}</div>
          <div className="mm-page__body">{children}</div>
        </main>
      )}
    </div>
  );
}
