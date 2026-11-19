import type { Me } from "@magomap/domain";
import { Route, Switch } from "wouter";
import { Account } from "./screens/Account";

/** The pages shown in the panel (desktop) or over the map (phone). */
export function PageRoutes({ me }: { me: Me }) {
  return (
    <Switch>
      <Route path="/account">
        <Account me={me} />
      </Route>
      <Route>{null}</Route>
    </Switch>
  );
}
