import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { createList } from "../data/writes";
import { useLayout } from "../layout/useLayout";
import { ListForm } from "../lists/ListForm";
import { ListPicker } from "../map/ListPicker";
import { useMapData } from "../map/useMapData";

/** The lists: open one from its row, or switch it on or off the map. */
export function ListsScreen() {
  const { t } = useTranslation();
  const lists = useMapData()?.sections;
  const [, navigate] = useLocation();
  const layout = useLayout();
  const [creating, setCreating] = useState(false);
  if (!lists) return null;
  return (
    <div className="mm-screen">
      <div className={`mm-section__head${layout === "desktop" ? "" : " mm-section__head--end"}`}>
        {layout === "desktop" && <h1 className="mm-screen__title">{t("lists.title")}</h1>}
        <button
          type="button"
          className="mm-button mm-button--primary"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden size={18} strokeWidth={1.75} />
          {t("lists.newList")}
        </button>
      </div>
      <ListPicker sections={lists} />
      {creating && (
        <ConfirmDialog title={t("lists.newList")} role="dialog" onCancel={() => setCreating(false)}>
          <ListForm
            submitLabel={t("lists.create")}
            onCancel={() => setCreating(false)}
            onSubmit={(v) => {
              void createList(v).then((id) => {
                setCreating(false);
                navigate(`/lists/${encodeURIComponent(id)}`);
              });
            }}
          />
        </ConfirmDialog>
      )}
    </div>
  );
}
