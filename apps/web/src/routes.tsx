import type { Me } from "@magomap/domain";
import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import { decodeId } from "./decodeId";
import { useLayout } from "./layout/useLayout";
import { HomePanel } from "./screens/MapScreen";

// The pages beside or over the map are loaded when first opened: the map is what every start
// shows, so only it is in the first JavaScript (scripts/check-bundle.mjs keeps that small).
const PlaceScreen = lazy(() =>
  import("./place/PlaceScreen").then((m) => ({ default: m.PlaceScreen })),
);
const Account = lazy(() => import("./screens/Account").then((m) => ({ default: m.Account })));
const ListScreen = lazy(() =>
  import("./screens/ListScreen").then((m) => ({ default: m.ListScreen })),
);
const ListsScreen = lazy(() =>
  import("./screens/ListsScreen").then((m) => ({ default: m.ListsScreen })),
);

/** The pages shown in the panel (desktop) or over the map (phone). */
export function PageRoutes({ me }: { me: Me }) {
  const layout = useLayout();
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/account">
          <Account me={me} />
        </Route>
        <Route path="/lists">
          <ListsScreen />
        </Route>
        <Route path="/lists/:id">{(p) => <ListScreen id={decodeId(p.id)} />}</Route>
        {/* Import lives in Account now; old links still land there. */}
        <Route path="/import">
          <Redirect to="/account" replace />
        </Route>
        <Route path="/places/:id/details">
          {(p) => <PlaceScreen key={p.id} id={decodeId(p.id)} />}
        </Route>
        {/* On a phone a place is a peek over the map (rendered by the map layer), not a page. */}
        <Route path="/places/:id">
          {(p) => (layout === "phone" ? null : <PlaceScreen key={p.id} id={decodeId(p.id)} />)}
        </Route>
        <Route path="/">
          <HomePanel />
        </Route>
        <Route>{null}</Route>
      </Switch>
    </Suspense>
  );
}
