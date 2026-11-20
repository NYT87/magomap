import type { Me } from "@magomap/domain";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch } from "wouter";
import { useMe } from "./auth/useMe";
import { SyncIndicator } from "./components/SyncIndicator";
import { SyncProvider } from "./data/SyncProvider";
import { useUserDb } from "./data/useUserDb";
import { AppLayout } from "./layout/AppLayout";
import { useLayout } from "./layout/useLayout";
import { MapStageProvider } from "./map/MapStage";
import { MapPrefsProvider } from "./map/mapPrefs";
import { PageRoutes } from "./routes";
import { MapScreen } from "./screens/MapScreen";
import { NotInvited } from "./screens/NotInvited";
import { SignIn } from "./screens/SignIn";
import { UpdateBanner } from "./update/UpdateBanner";
import { UpdateRegistration } from "./update/UpdateRegistration";

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
  return <Signedin me={me} />;
}

function Signedin({ me }: { me: Me }) {
  // Each account has its own local database; signing out keeps it for the next sign-in. A new
  // account, or a database replaced under us, starts everything below over.
  const { key } = useUserDb(me.userId);
  const layout = useLayout();
  return (
    <SyncProvider key={key}>
      <MapPrefsProvider userId={me.userId}>
        <MapStageProvider>
          <AppLayout
            map={<MapScreen />}
            status={<SyncIndicator compact={layout === "phone"} />}
            notice={<UpdateBanner />}
          >
            <PageRoutes me={me} />
          </AppLayout>
        </MapStageProvider>
      </MapPrefsProvider>
    </SyncProvider>
  );
}

export function App() {
  return (
    <>
      <UpdateRegistration />
      <Switch>
        <Route path="/signin" component={SignIn} />
        <Route path="/not-invited" component={NotInvited} />
        <Route>
          <Shell />
        </Route>
      </Switch>
    </>
  );
}
