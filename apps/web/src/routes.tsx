import type { Me } from "@magomap/domain";
import { Redirect, Route, Switch } from "wouter";
import { PlaceScreen } from "./place/PlaceScreen";
import { Account } from "./screens/Account";
import { ListScreen } from "./screens/ListScreen";
import { ListsScreen } from "./screens/ListsScreen";
import { HomePanel } from "./screens/MapScreen";

/** The pages shown in the panel (desktop) or over the map (phone). */
export function PageRoutes({ me }: { me: Me }) {
  return (
    <Switch>
      <Route path="/account">
        <Account me={me} />
      </Route>
      <Route path="/lists">
        <ListsScreen />
      </Route>
      <Route path="/lists/:id">{(p) => <ListScreen id={decodeURIComponent(p.id)} />}</Route>
      {/* Import lives in Account now; old links still land there. */}
      <Route path="/import">
        <Redirect to="/account" replace />
      </Route>
      <Route path="/places/:id">
        {(p) => <PlaceScreen key={p.id} id={decodeURIComponent(p.id)} />}
      </Route>
      <Route path="/">
        <HomePanel />
      </Route>
      <Route>{null}</Route>
    </Switch>
  );
}
