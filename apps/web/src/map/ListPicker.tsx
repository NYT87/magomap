import type { ListRow } from "@magomap/domain";
import { ChevronRight, Lock } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { SAVED_GROUP } from "../data/queries";
import { useListArrival } from "../data/useSyncStatus";
import { providerUi } from "../providers";
import { useMapPrefs } from "./mapPrefs";

export interface PickerList {
  list: ListRow;
  count: number;
  color: string;
}

export interface Sections {
  mine: PickerList[];
  provider: PickerList[];
  subscribed: PickerList[];
  savedNotInList: number;
}

/** An on/off switch. Its name comes from `label`; `children` is optional visible text. */
function Switch({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={children ? "mm-switch" : "mm-switch mm-switch--bare"}
      onClick={() => onChange(!checked)}
    >
      {children}
      <span className="mm-switch__track" aria-hidden>
        <span className="mm-switch__thumb" />
      </span>
    </button>
  );
}

/** A list: the row opens it, the switch at the end shows or hides it on the map. */
function Row({
  id,
  href,
  name,
  detail,
  swatch,
  readOnly,
}: {
  id: string;
  href: string;
  name: string;
  detail: string;
  swatch: ReactNode;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { hidden, setVisible } = useMapPrefs();
  return (
    <li className="mm-list-row">
      <Link href={href} className="mm-list-row__link">
        {swatch}
        <span className="mm-switch__label">
          <span className="mm-switch__name">{name}</span>
          <span className="mm-muted">{detail}</span>
        </span>
        {readOnly && <Lock aria-hidden size={16} strokeWidth={1.75} className="mm-muted" />}
        <ChevronRight aria-hidden size={18} strokeWidth={1.75} className="mm-muted" />
      </Link>
      <Switch
        checked={!hidden.has(id)}
        onChange={(on) => setVisible([id], on)}
        label={t("picker.toggle", { name })}
      />
    </li>
  );
}

function Section({ title, ids, children }: { title: string; ids: string[]; children: ReactNode }) {
  const { t } = useTranslation();
  const { setVisible } = useMapPrefs();
  const id = useId();
  return (
    <fieldset className="mm-picker__section" aria-labelledby={id}>
      <div className="mm-picker__head">
        <h2 className="mm-picker__title" id={id}>
          {title}
        </h2>
        <span className="mm-picker__bulk">
          <button type="button" className="mm-link-button" onClick={() => setVisible(ids, true)}>
            {t("picker.showAll")}
          </button>
          <button type="button" className="mm-link-button" onClick={() => setVisible(ids, false)}>
            {t("picker.hideAll")}
          </button>
        </span>
      </div>
      <ul className="mm-picker__list">{children}</ul>
    </fieldset>
  );
}

/**
 * The lists, in three sections (empty ones left out): each row opens its list, and its switch
 * shows or hides it on the map. Saved places outside lists count as a row of My lists.
 */
export function ListPicker({ sections }: { sections: Sections }) {
  const { t } = useTranslation();
  const { showPrevious, setShowPrevious } = useMapPrefs();
  const arrival = useListArrival();
  const ids = (ls: PickerList[]) => ls.map((l) => l.list.id);
  const row = (
    { list, count, color }: PickerList,
    opts: { owner?: boolean; readOnly?: boolean },
  ) => (
    <Row
      key={list.id}
      id={list.id}
      href={`/lists/${encodeURIComponent(list.id)}`}
      name={list.name}
      detail={
        // A Kakao list just gained may arrive before its places: not "0 places" while they come.
        (count === 0 && list.provider != null && arrival
          ? t(arrival === "downloading" ? "picker.downloading" : "picker.downloadWaiting")
          : t("picker.count", { count })) +
        (opts.owner && list.ownerName ? ` · ${t("picker.by", { name: list.ownerName })}` : "")
      }
      swatch={<span className="mm-swatch" style={{ background: color }} aria-hidden />}
      readOnly={opts.readOnly}
    />
  );
  const provider = providerUi(sections.provider[0]?.list.provider ?? "kakao");
  const subscribedUi = providerUi(sections.subscribed[0]?.list.provider ?? "kakao");
  const hasMine = sections.mine.length > 0 || sections.savedNotInList > 0;
  const nothing = !hasMine && sections.provider.length === 0 && sections.subscribed.length === 0;

  return (
    <div className="mm-picker">
      {hasMine && (
        <Section
          title={t("picker.mine")}
          ids={[...ids(sections.mine), ...(sections.savedNotInList > 0 ? [SAVED_GROUP] : [])]}
        >
          {sections.mine.map((l) => row(l, {}))}
          {sections.savedNotInList > 0 && (
            <Row
              id={SAVED_GROUP}
              href={`/lists/${SAVED_GROUP}`}
              name={t("picker.saved")}
              detail={t("picker.count", { count: sections.savedNotInList })}
              swatch={<span className="mm-swatch mm-swatch--ring" aria-hidden />}
            />
          )}
        </Section>
      )}
      {sections.provider.length > 0 && (
        <Section title={t(provider.listsKey)} ids={ids(sections.provider)}>
          {sections.provider.map((l) => row(l, { readOnly: true }))}
        </Section>
      )}
      {sections.subscribed.length > 0 && (
        <Section title={t(subscribedUi.subscribedKey)} ids={ids(sections.subscribed)}>
          {sections.subscribed.map((l) => row(l, { owner: true, readOnly: true }))}
        </Section>
      )}
      {nothing && <p className="mm-muted">{t("picker.hint")}</p>}
      <Switch checked={showPrevious} onChange={setShowPrevious} label={t("picker.showPrevious")}>
        <span className="mm-switch__label">
          <span className="mm-switch__name">{t("picker.showPrevious")}</span>
        </span>
      </Switch>
    </div>
  );
}
