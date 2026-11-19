import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch } from "wouter";
import { useMe } from "./auth/useMe";
import { AppLayout } from "./layout/AppLayout";
import { PageRoutes } from "./routes";
import { NotInvited } from "./screens/NotInvited";
import { SignIn } from "./screens/SignIn";

function askPersistentStorage() {
  try {
    if (localStorage.getItem("mm.persisted")) return;
    localStorage.setItem("mm.persisted", "1");
  } catch {
    return;
  }
  void navigator.storage?.persist?.();
}

function Shell() {
  const { me, loading } = useMe();
  const { t } = useTranslation();
  useEffect(() => {
    if (me) askPersistentStorage();
  }, [me]);
  if (loading) {
    return (
      <div className="mm-splash" role="status">
        {t("app.loading")}
      </div>
    );
  }
  if (!me) return <Redirect to="/signin" />;
  return (
    <AppLayout map={<div className="mm-map__placeholder" />}>
      <PageRoutes me={me} />
    </AppLayout>
  );
}

export function App() {
  return (
    <Switch>
      <Route path="/signin" component={SignIn} />
      <Route path="/not-invited" component={NotInvited} />
      <Route>
        <Shell />
      </Route>
    </Switch>
  );
}
