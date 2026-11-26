import { describe, expect, it } from "vitest";
import { KAKAO_PLACE_COLORS, kakaoFolderIdOf, kakaoListExternalId, usableNickname } from "./kakao";

describe("Kakao list ids", () => {
  // Every Kakao user has a folder 0 (their default favourites): it must never be shared.
  it("gives folder 0 a per-person external id, and keeps every other folder's id", () => {
    expect(kakaoListExternalId(0, "111")).toBe("0~111");
    expect(kakaoListExternalId(0, "222")).toBe("0~222");
    expect(kakaoListExternalId(101, "111")).toBe("101");
  });

  it("reads the folder id back from an external id", () => {
    expect(kakaoFolderIdOf("101")).toBe(101);
    expect(kakaoFolderIdOf("0~111")).toBe(0);
    for (const bad of ["", "abc", "0~", "1~111", "-1", "1.5", "0~111~2"]) {
      expect(kakaoFolderIdOf(bad)).toBeUndefined();
    }
  });
});

describe("usableNickname", () => {
  it("trims a nickname and cuts it to 40 characters", () => {
    expect(usableNickname(" 지은 ")).toBe("지은");
    expect(usableNickname("가".repeat(60))).toBe("가".repeat(40));
  });

  it("drops a nickname it can't use", () => {
    for (const bad of ["", "   ", 123, "a\u0000b", undefined]) {
      expect(usableNickname(bad)).toBeUndefined();
    }
  });
});

describe("KAKAO_PLACE_COLORS", () => {
  it("names Kakao Map's seven favourite colours by their two-digit codes", () => {
    expect(Object.keys(KAKAO_PLACE_COLORS)).toEqual(["01", "02", "03", "04", "05", "06", "07"]);
  });

  it("are Kakao Map's own colours, as its page shows them", () => {
    expect(KAKAO_PLACE_COLORS).toEqual({
      "01": { name: "red", value: "#f96061" },
      "02": { name: "yellow", value: "#ffc43b" },
      "03": { name: "orange", value: "#ff9340" },
      "04": { name: "green", value: "#96d147" },
      "05": { name: "darkGreen", value: "#56c07c" },
      "06": { name: "purple", value: "#a088ff" },
      "07": { name: "pink", value: "#e879c5" },
    });
  });
});
