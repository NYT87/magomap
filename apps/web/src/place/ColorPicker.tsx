import { KAKAO_PLACE_COLORS } from "@magomap/domain/providers/kakao";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ColorError, setPlaceColor } from "./setPlaceColor";

const errorKey = (code: string) =>
  ({
    extension_missing: "place.color.errExtension",
    account_mismatch: "place.color.errAccount",
    account_unconfirmed: "place.color.errUnconfirmed",
    kakao_signed_out: "place.color.errSignedOut",
    not_found: "place.color.errNotFound",
    not_owner: "place.color.errNotOwner",
    busy: "place.color.errBusy",
    offline: "place.color.errOffline",
    server_failed: "place.color.errServer",
  })[code] ?? "place.color.errUnavailable";

/**
 * The 7 Kakao colours as a radio group for one place in one list. Choosing one changes it at once
 * (Kakao Map first, for a Kakao list) and closes the group; a failure says why and keeps it open.
 */
export function ColorPicker({
  itemId,
  listName,
  current,
  onDone,
}: {
  itemId: string;
  listName: string;
  /** The Kakao colour code the place has in this list now, if any. */
  current: string | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap before the first finishes must not send a second change.
  const working = useRef(false);

  const choose = (color: string) => {
    if (working.current || color === current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setPlaceColor({ itemId, color }).then(
      () => {
        working.current = false;
        setBusy(false);
        onDone();
      },
      (e) => {
        working.current = false;
        setBusy(false);
        setError(e instanceof ColorError ? e.code : "kakao_unavailable");
      },
    );
  };

  return (
    <fieldset className="mm-color-picker" aria-busy={busy}>
      <legend className="mm-visually-hidden">{t("place.color.in", { name: listName })}</legend>
      {Object.entries(KAKAO_PLACE_COLORS).map(([code, { name, value }]) => (
        // Real buttons, so arrow keys only move focus: a colour is sent only on click or Enter.
        <button
          key={code}
          type="button"
          className="mm-color-picker__option"
          aria-pressed={current === code}
          aria-label={t(`place.color.names.${name}`)}
          onClick={() => choose(code)}
        >
          <span className="mm-color-picker__dot" style={{ background: value }} aria-hidden />
        </button>
      ))}
      <p role="status" className="mm-muted mm-color-picker__status">
        {busy ? t("place.color.saving") : ""}
      </p>
      {error && (
        <p role="alert" className="mm-error">
          {t(errorKey(error))}
        </p>
      )}
    </fieldset>
  );
}
