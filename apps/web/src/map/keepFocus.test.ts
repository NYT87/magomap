import { afterEach, describe, expect, it } from "vitest";
import { redrawKeepingFocus } from "./keepFocus";

function mapWith(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}
const pin = (selected: boolean) =>
  `<div class="leaflet-marker-icon" tabindex="0" data-n="${selected ? "sel" : "plain"}"><span class="mm-pin${selected ? " mm-pin--selected" : ""}"></span></div>`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("redrawKeepingFocus", () => {
  it("moves focus to the new selected pin when focus was in the map", () => {
    const root = mapWith(pin(false));
    root.querySelector<HTMLElement>(".leaflet-marker-icon")?.focus();
    redrawKeepingFocus(root, () => {
      root.innerHTML = pin(true);
    });
    expect(document.activeElement).toBe(root.querySelector('[data-n="sel"]'));
  });

  it("works with Kakao's button host", () => {
    const root = mapWith('<button><span class="mm-pin"></span></button>');
    root.querySelector("button")?.focus();
    redrawKeepingFocus(root, () => {
      root.innerHTML = '<button id="s"><span class="mm-pin mm-pin--selected"></span></button>';
    });
    expect(document.activeElement?.id).toBe("s");
  });

  it("leaves focus alone when it was outside the map", () => {
    const root = mapWith(pin(false));
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    redrawKeepingFocus(root, () => {
      root.innerHTML = pin(true);
    });
    expect(document.activeElement).toBe(outside);
  });
});
