import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MapPrefsProvider, useMapPrefs } from "./mapPrefs";

const wrap =
  (userId: string) =>
  ({ children }: { children: ReactNode }) => (
    <MapPrefsProvider userId={userId}>{children}</MapPrefsProvider>
  );

describe("map preferences", () => {
  it("reads an unknown stored map choice as Automatic", () => {
    localStorage.setItem("mm.mapProvider.p1", "bogus");
    const { result } = renderHook(() => useMapPrefs(), { wrapper: wrap("p1") });
    expect(result.current.mapChoice).toBe("auto");
  });

  it("knows whether Kakao loaded, without storing it", () => {
    const { result } = renderHook(() => useMapPrefs(), { wrapper: wrap("p2") });
    expect(result.current.kakaoAvailable).toBeNull();
    const before = localStorage.length;
    act(() => result.current.setKakaoAvailable(false));
    expect(result.current.kakaoAvailable).toBe(false);
    expect(localStorage.length).toBe(before);
  });
});
