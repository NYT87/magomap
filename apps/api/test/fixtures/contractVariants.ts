import type { MagomapImportContract } from "@magomap/domain";
import { baseContract } from "./contract";

export type Variant =
  | { name: "base" }
  | { name: "withoutFavourite"; args: [string] }
  | { name: "incomplete" }
  | { name: "moved"; args: [string, number] };

export function contractFor(variant: Variant, kakaoUserId = "111"): MagomapImportContract {
  const c = baseContract(kakaoUserId);
  if (variant.name === "withoutFavourite") {
    for (const l of c.lists) l.items = l.items.filter((i) => i.favoriteSeq !== variant.args[0]);
  }
  if (variant.name === "incomplete") c.complete = false;
  if (variant.name === "moved") {
    const [seq, meters] = variant.args;
    for (const l of c.lists)
      for (const i of l.items)
        if (i.favoriteSeq === seq && i.lat !== undefined) i.lat += meters / 111_320;
  }
  return c;
}
