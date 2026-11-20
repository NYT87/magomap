import { describe, expect, it } from "vitest";
import { providerFor } from "./providerChoice";

const seoul = { lat: 37.57, lng: 126.98 };
const tokyo = { lat: 35.68, lng: 139.69 };
const edge = { lat: 39.0, lng: 127.0 }; // inside the outer box, outside the inner one
const dokdo = { lat: 37.24, lng: 131.87 };

describe("providerFor", () => {
  it("follows the centre on Automatic", () => {
    expect(providerFor("auto", seoul, null, true)).toBe("kakao");
    expect(providerFor("auto", tokyo, "kakao", true)).toBe("leaflet");
    expect(providerFor("auto", seoul, "leaflet", true)).toBe("kakao");
  });

  it("doesn't flip at the edge", () => {
    expect(providerFor("auto", edge, "kakao", true)).toBe("kakao");
    expect(providerFor("auto", edge, "leaflet", true)).toBe("leaflet");
    expect(providerFor("auto", dokdo, "kakao", true)).toBe("kakao");
  });

  it("obeys a forced choice", () => {
    expect(providerFor("kakao", tokyo, "leaflet", true)).toBe("kakao");
    expect(providerFor("osm", seoul, "kakao", true)).toBe("leaflet");
  });

  it("uses OpenStreetMap whenever Kakao isn't available", () => {
    expect(providerFor("kakao", seoul, null, false)).toBe("leaflet");
    expect(providerFor("auto", seoul, null, false)).toBe("leaflet");
  });
});
