import type { HTMLAttributes, MouseEvent } from "react";

/**
 * A card that opens with a tap, as Kakao Map's place card does: a click anywhere on it calls
 * `onOpen`, except on a button inside it (its own actions). Spread the result on the card; the
 * keyboard's way in is a real button inside the card.
 */
export function cardTap(onOpen: () => void): Pick<HTMLAttributes<HTMLElement>, "onClick"> {
  return {
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (!(e.target as HTMLElement).closest("button")) onOpen();
    },
  };
}
