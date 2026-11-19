import type { Me } from "@magomap/domain";
import { Route, Switch } from "wouter";
import { PlaceScreen } from "./place/PlaceScreen";
import { Account } from "./screens/Account";
import { HomePanel } from "./screens/MapScreen";

/** The pages shown in the panel (desktop) or over the map (phone). */
export function PageRoutes({ me }: { me: Me }) {
  return (
    <Switch>
      <Route path="/account">
        <Account me={me} />
      </Route>
      <Route path="/places/:id">{(p) => <PlaceScreen id={decodeURIComponent(p.id)} />}</Route>
      <Route path="/">
        <HomePanel />
      </Route>
      <Route>{null}</Route>
    </Switch>
  );
}
