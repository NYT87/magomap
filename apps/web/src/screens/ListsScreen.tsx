import type { ListRow } from "@magomap/domain";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SAVED_GROUP } from "../data/queries";
import { createList } from "../data/writes";
import { ListForm } from "../lists/ListForm";
import { useMapData } from "../map/useMapData";
import { providerUi } from "../providers";

function Row({
  list,
  count,
  color,
  readOnly,
}: {
  list: ListRow;
  count: number;
  color: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <Link href={`/lists/${encodeURIComponent(list.id)}`} className="mm-list-row">
        <span className="mm-swatch" style={{ background: color }} aria-hidden />
        <span className="mm-switch__label">
          <span className="mm-switch__name">{list.name}</span>
          <span className="mm-muted">
            {t("picker.count", { count })}
            {list.ownerName && readOnly ? ` · ${t("picker.by", { name: list.ownerName })}` : ""}
          </span>
        </span>
        {readOnly && <Lock aria-hidden size={16} strokeWidth={1.75} className="mm-muted" />}
      </Link>
    </li>
  );
}

/** My lists (and saved places outside lists), Kakao lists, and lists subscribed in Kakao. */
export function ListsScreen() {
  const { t } = useTranslation();
  const lists = useMapData()?.sections;
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  if (!lists) return null;
  const provider = providerUi(lists.provider[0]?.list.provider ?? "kakao");
  return (
    <div className="mm-screen">
      <div className="mm-section__head">
        <h1 className="mm-screen__title">{t("lists.title")}</h1>
        <button
          type="button"
          className="mm-button mm-button--primary"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden size={18} strokeWidth={1.75} />
          {t("lists.newList")}
        </button>
      </div>
      <section className="mm-section" aria-labelledby="mine">
        <h2 id="mine" className="mm-picker__title">
          {t("picker.mine")}
        </h2>
        <ul className="mm-picker__list">
          {lists.mine.map(({ list, count, color }) => (
            <Row key={list.id} list={list} count={count} color={color} />
          ))}
          {lists.savedNotInList > 0 && (
            <li>
              <Link href={`/lists/${SAVED_GROUP}`} className="mm-list-row">
                <span className="mm-swatch mm-swatch--ring" aria-hidden />
                <span className="mm-switch__label">
                  <span className="mm-switch__name">{t("picker.saved")}</span>
                  <span className="mm-muted">
                    {t("picker.count", { count: lists.savedNotInList })}
                  </span>
                </span>
              </Link>
            </li>
          )}
        </ul>
        {lists.mine.length === 0 && lists.savedNotInList === 0 && (
          <p className="mm-muted">{t("picker.none")}</p>
        )}
      </section>
      {lists.provider.length > 0 && (
        <section className="mm-section" aria-labelledby="provider">
          <h2 id="provider" className="mm-picker__title">
            {t(provider.listsKey)}
          </h2>
          <ul className="mm-picker__list">
            {lists.provider.map(({ list, count, color }) => (
              <Row key={list.id} list={list} count={count} color={color} readOnly />
            ))}
          </ul>
        </section>
      )}
      {lists.subscribed.length > 0 && (
        <section className="mm-section" aria-labelledby="subscribed">
          <h2 id="subscribed" className="mm-picker__title">
            {t(provider.subscribedKey)}
          </h2>
          <ul className="mm-picker__list">
            {lists.subscribed.map(({ list, count, color }) => (
              <Row key={list.id} list={list} count={count} color={color} readOnly />
            ))}
          </ul>
        </section>
      )}
      {lists.provider.length === 0 && lists.subscribed.length === 0 && (
        <p className="mm-muted">{t("picker.hint")}</p>
      )}
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
