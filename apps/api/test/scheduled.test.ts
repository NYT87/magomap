import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { dailyCleanUp } from "../src/scheduled";

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("daily clean-up", () => {
  it("the Worker has a scheduled handler", () => {
    expect(typeof app.scheduled).toBe("function");
    expect(typeof app.fetch).toBe("function");
  });

  it("closes a run abandoned for a week and deletes its pages", async () => {
    const db = env.DB;
    await db
      .prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', NULL, 0)")
      .run();
    await db
      .prepare(
        "INSERT INTO import_runs (user_id, id, provider, source, started_at, status, complete, subscription_known, snapshot_at) VALUES ('u1', 'r1', 'kakao', 'kakao_list', 1000, 'running', 1, 1, 1000)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO import_run_pages (user_id, run_id, external_id, page, item_ids) VALUES ('u1', 'r1', '1', 0, '[]')",
      )
      .run();

    expect(await dailyCleanUp(env, 1000 + WEEK - 1)).toBe(0);
    expect(await dailyCleanUp(env, 1000 + WEEK + 1)).toBe(1);

    const run = await db
      .prepare("SELECT status FROM import_runs WHERE id = 'r1'")
      .first<{ status: string }>();
    expect(run?.status).toBe("superseded");
    const pages = await db
      .prepare("SELECT COUNT(*) AS n FROM import_run_pages")
      .first<{ n: number }>();
    expect(pages?.n).toBe(0);
  });
});
