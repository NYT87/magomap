import type { ListRow } from "@magomap/domain";
import { useTranslation } from "react-i18next";
import { SAVED_GROUP } from "../data/queries";
import { providerUi } from "../providers";
import { useMapPrefs } from "./mapPrefs";

export interface PickerList {
  list: ListRow;
  count: number;
  color: string;
}

interface Props {
  /** False inside a sheet that already shows the title. */
  heading?: boolean;
  sections: {
    mine: PickerList[];
    provider: PickerList[];
    subscribed: PickerList[];
    savedNotInList: number;
  };
}

function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="mm-switch"
      onClick={() => onChange(!checked)}
    >
      {children}
      <span className="mm-switch__track" aria-hidden>
        <span className="mm-switch__thumb" />
      </span>
    </button>
  );
}

function Section({
  title,
  ids,
  children,
}: {
  title: string;
  ids: string[];
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { setVisible } = useMapPrefs();
  return (
    <fieldset className="mm-picker__section" aria-label={title}>
      <div className="mm-picker__head">
        <h3 className="mm-picker__title">{title}</h3>
        {ids.length > 0 && (
          <span className="mm-picker__bulk">
            <button type="button" className="mm-link-button" onClick={() => setVisible(ids, true)}>
              {t("picker.showAll")}
            </button>
            <button type="button" className="mm-link-button" onClick={() => setVisible(ids, false)}>
              {t("picker.hideAll")}
            </button>
          </span>
        )}
      </div>
      {children}
    </fieldset>
  );
}

/** Which lists show on the map: three sections, plus saved places outside lists. */
export function ListPicker({ sections, heading = true }: Props) {
  const { t } = useTranslation();
  const { hidden, setVisible, showPrevious, setShowPrevious } = useMapPrefs();
  const row = ({ list, count, color }: PickerList, withOwner = false) => (
    <li key={list.id}>
      <Switch checked={!hidden.has(list.id)} onChange={(on) => setVisible([list.id], on)}>
        <span className="mm-swatch" style={{ background: color }} aria-hidden />
        <span className="mm-switch__label">
          <span className="mm-switch__name">{list.name}</span>
          <span className="mm-muted">
            {t("picker.count", { count })}
            {withOwner && list.ownerName ? ` · ${t("picker.by", { name: list.ownerName })}` : ""}
          </span>
        </span>
      </Switch>
    </li>
  );
  const ids = (ls: PickerList[]) => ls.map((l) => l.list.id);
  const all = [
    ...ids(sections.mine),
    ...ids(sections.provider),
    ...ids(sections.subscribed),
    SAVED_GROUP,
  ];
  const provider = providerUi(sections.provider[0]?.list.provider ?? "kakao");
  const subscribedUi = providerUi(sections.subscribed[0]?.list.provider ?? "kakao");

  return (
    <div className="mm-picker">
      <div className="mm-picker__head">
        {heading && <h2 className="mm-h4">{t("picker.title")}</h2>}
        <span className="mm-picker__bulk">
          <button type="button" className="mm-link-button" onClick={() => setVisible(all, true)}>
            {t("picker.showAll")}
          </button>
          <button type="button" className="mm-link-button" onClick={() => setVisible(all, false)}>
            {t("picker.hideAll")}
          </button>
        </span>
      </div>
      <Section title={t("picker.mine")} ids={ids(sections.mine)}>
        <ul className="mm-picker__list">
          {sections.mine.map((l) => row(l))}
          {sections.savedNotInList > 0 && (
            <li>
              <Switch
                checked={!hidden.has(SAVED_GROUP)}
                onChange={(on) => setVisible([SAVED_GROUP], on)}
              >
                <span className="mm-swatch mm-swatch--ring" aria-hidden />
                <span className="mm-switch__label">
                  <span className="mm-switch__name">{t("picker.saved")}</span>
                  <span className="mm-muted">
                    {t("picker.count", { count: sections.savedNotInList })}
                  </span>
                </span>
              </Switch>
            </li>
          )}
          {sections.mine.length === 0 && sections.savedNotInList === 0 && (
            <li className="mm-muted">{t("picker.none")}</li>
          )}
        </ul>
      </Section>
      <Section title={t(provider.listsKey)} ids={ids(sections.provider)}>
        <ul className="mm-picker__list">
          {sections.provider.map((l) => row(l))}
          {sections.provider.length === 0 && <li className="mm-muted">{t("picker.none")}</li>}
        </ul>
      </Section>
      <Section title={t(subscribedUi.subscribedKey)} ids={ids(sections.subscribed)}>
        <ul className="mm-picker__list">
          {sections.subscribed.map((l) => row(l, true))}
          {sections.subscribed.length === 0 && <li className="mm-muted">{t("picker.none")}</li>}
        </ul>
      </Section>
      <Switch checked={showPrevious} onChange={setShowPrevious}>
        <span className="mm-switch__label">
          <span className="mm-switch__name">{t("picker.showPrevious")}</span>
        </span>
      </Switch>
    </div>
  );
}
