import { ArrowLeft, List, Map as MapIcon, UserRound } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { goBackOr } from "./appHistory";
import { placeRouteOf, switchesPlace } from "./placeRoute";
import { useLayout } from "./useLayout";

export const SEARCH_INPUT_ID = "mm-search";

interface Props {
  /** The map; stays mounted on every route. */
  map: ReactNode;
  /** The routed page (ignored on the phone map routes, where the map is the page). */
  children: ReactNode;
  /** The sync indicator: in the header on desktop and on phone pages (the map has its own). */
  status?: ReactNode;
  /** A notice shown under the status on desktop, under the header on phone pages, and where the
   *  map renders `<NoticeSlot />` on the phone map. It remounts when the phone switches between
   *  map and page; what it shows lives in the caller's store (useAppUpdate), not in the notice. */
  notice?: ReactNode;
}

const NoticeContext = createContext<ReactNode>(null);

/** Where the phone map shows the layout's notice (in its notes above the nav). */
export function NoticeSlot() {
  return <>{useContext(NoticeContext)}</>;
}

/** Pages whose title sits in the phone header, by exact path. */
const HEADER_TITLES: Record<string, string> = {
  "/account": "account.title",
  "/lists": "lists.title",
};

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
  const placeRoute = placeRouteOf(location);
  // On a phone the map is the screen at "/" and at a place's peek; every other route is a page.
  const onMap = location === "/" || (placeRoute !== null && !placeRoute.details);
  const titleKey = HEADER_TITLES[location];

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
      // On a phone, Escape closes a place's peek the way its X does (not its details page).
      if (e.key === "Escape" && layout === "phone" && switchesPlace(location)) {
        goBackOr(navigate, "/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layout, location, navigate]);

  // The window title follows the screen; on phones, focus moves to the new page's heading.
  useEffect(() => {
    const section = location.split("/")[1] ?? "";
    // A place's card and page name the place themselves (this runs after them).
    if (section === "places") return;
    const key = { lists: "nav.lists", account: "nav.account" }[section];
    document.title = key ? `${t(key)} – ${t("app.name")}` : t("app.name");
  }, [location, t]);
  const page = useRef<HTMLElement>(null);
  const pageRoute = onMap ? null : location;
  useEffect(() => {
    if (layout !== "phone" || pageRoute === null) return;
    const heading = page.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [layout, pageRoute]);

  // Back to the map from a place's peek (its X, Escape or Back): focus goes to the search field,
  // since the card that held it is gone.
  const previous = useRef(location);
  useEffect(() => {
    const was = previous.current;
    previous.current = location;
    if (layout === "phone" && location === "/" && switchesPlace(was)) {
      document.getElementById(SEARCH_INPUT_ID)?.focus({ preventScroll: true });
    }
  }, [layout, location]);

  // Opened with no history in the app: from a place's details, back is its peek, not a blank map.
  const back = () =>
    goBackOr(navigate, placeRoute ? `/places/${encodeURIComponent(placeRoute.id)}` : "/");

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
      <main className="mm-map" hidden={!onMap}>
        <NoticeContext.Provider value={onMap ? notice : null}>{map}</NoticeContext.Provider>
      </main>
      {onMap ? (
        <Nav current={location} />
      ) : (
        <main className="mm-page" ref={page}>
          <header className="mm-page__header">
            <button type="button" className="mm-icon-button" onClick={back}>
              <ArrowLeft aria-hidden size={22} strokeWidth={1.75} />
              <span className="mm-visually-hidden">{t("nav.back")}</span>
            </button>
            {titleKey && <h1 className="mm-page__title">{t(titleKey)}</h1>}
            {status}
          </header>
          <div className="mm-page__notice">{notice}</div>
          <div className="mm-page__body">{children}</div>
        </main>
      )}
    </div>
  );
}
