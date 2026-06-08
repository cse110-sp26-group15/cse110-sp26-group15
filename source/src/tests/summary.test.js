import { describe, expect, it, vi } from "vitest";
import {
  buildPrompt,
  fallbackSummary,
  callAnthropic,
  onRequestPost,
} from "../../../functions/api/projects/[projectId]/summary.js";
import { renderSummaryHtml } from "../../dashboard/scrum.js";

function makeDb({ checkins = [], blockers = [], throwOn = null } = {}) {
  return {
    prepare: vi.fn((sql) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => {
          if (throwOn && sql.includes(throwOn)) throw new Error("db boom");
          if (sql.includes("FROM checkins")) return { results: checkins };
          if (sql.includes("FROM blockers")) return { results: blockers };
          return { results: [] };
        }),
      })),
    })),
  };
}

describe("AI summarizer — buildPrompt", () => {
  it("inlines every check-in and blocker into the prompt", () => {
    const prompt = buildPrompt(
      [
        { full_name: "Alex", work_done: "wrote docs", work_planned: "PR review" },
        { full_name: "Sam", work_done: "shipped auth", work_planned: "vacation" },
      ],
      [{ reported_by: "Alex", description: "waiting on API key", helper: "Pat" }]
    );

    expect(prompt).toContain("Alex");
    expect(prompt).toContain("Sam");
    expect(prompt).toContain("wrote docs");
    expect(prompt).toContain("shipped auth");
    expect(prompt).toContain("waiting on API key");
    expect(prompt).toContain("(needs: Pat)");
  });

  it("renders empty markers when there are no check-ins or blockers", () => {
    const prompt = buildPrompt([], []);
    expect(prompt).toMatch(/CHECK-INS .*\n\(none\)/);
    expect(prompt).toMatch(/OPEN BLOCKERS:\n\(none\)/);
  });

  it("defaults missing fields so a half-filled check-in still renders", () => {
    const prompt = buildPrompt([{ full_name: "Sam", work_done: null, work_planned: "" }], []);
    expect(prompt).toContain("(no update)");
    expect(prompt).toContain("(no plan)");
  });
});

describe("AI summarizer — fallbackSummary", () => {
  it("returns a quiet-standup message when there is no activity", () => {
    expect(fallbackSummary([], [])).toMatch(/No check-ins/);
  });

  it("counts check-ins and lists distinct names when activity exists", () => {
    const summary = fallbackSummary(
      [{ full_name: "Alex" }, { full_name: "Sam" }, { full_name: "Alex" }],
      []
    );
    expect(summary).toContain("3 check-ins");
    expect(summary).toContain("Alex, Sam");
    expect(summary).toContain("no open blockers");
  });

  it("singularizes counts of 1", () => {
    const summary = fallbackSummary([{ full_name: "Alex" }], [{ description: "x" }]);
    expect(summary).toContain("1 check-in from");
    expect(summary).toContain("1 open blocker.");
  });

  it("truncates name list with +N when more than 3 people", () => {
    const summary = fallbackSummary(
      [
        { full_name: "Alex" },
        { full_name: "Sam" },
        { full_name: "Pat" },
        { full_name: "Robin" },
        { full_name: "Jordan" },
      ],
      []
    );
    expect(summary).toMatch(/\+2 others/);
  });
});

describe("AI summarizer — callAnthropic", () => {
  it("sends the API key and model, then unwraps the completion", async () => {
    const fakeFetch = vi.fn(async (url, init) => {
      expect(url).toContain("anthropic.com");
      expect(init.method).toBe("POST");
      const headers = init.headers;
      expect(headers["x-api-key"]).toBe("sk-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(init.body);
      expect(body.model).toMatch(/claude/);
      expect(body.messages[0].content).toContain("prompt-here");
      return new Response(JSON.stringify({ content: [{ text: "Looks calm today.\n" }] }), {
        status: 200,
      });
    });
    const text = await callAnthropic("sk-test", "prompt-here", fakeFetch);
    expect(text).toBe("Looks calm today.");
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it("throws when Anthropic returns non-2xx", async () => {
    const fakeFetch = async () => new Response("rate limited", { status: 429 });
    await expect(callAnthropic("sk-test", "x", fakeFetch)).rejects.toThrow(/429/);
  });

  it("throws when Anthropic returns an empty completion", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ content: [{ text: "" }] }), { status: 200 });
    await expect(callAnthropic("sk-test", "x", fakeFetch)).rejects.toThrow(/empty/);
  });
});

describe("AI summarizer — onRequestPost handler", () => {
  it("returns the fallback summary when ANTHROPIC_API_KEY is unset", async () => {
    const db = makeDb({
      checkins: [{ full_name: "Alex", work_done: "x", work_planned: "y" }],
      blockers: [],
    });
    const res = await onRequestPost({
      env: { DB: db },
      params: { projectId: "1" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.model).toBeNull();
    expect(body.summary).toMatch(/check-in/);
    expect(body.source_counts).toEqual({ checkins: 1, blockers: 0 });
  });

  it("calls Anthropic and surfaces the model output when a key is set", async () => {
    const db = makeDb({
      checkins: [{ full_name: "Alex", work_done: "x", work_planned: "y" }],
      blockers: [],
    });
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ text: "Crisp digest." }] }), { status: 200 })
    );
    const res = await onRequestPost({
      env: { DB: db, ANTHROPIC_API_KEY: "sk-test" },
      params: { projectId: "1" },
      fetch: fakeFetch,
    });
    const body = await res.json();
    expect(body.source).toBe("anthropic");
    expect(body.summary).toBe("Crisp digest.");
    expect(body.model).toContain("claude");
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it("degrades to the fallback when the Anthropic call fails", async () => {
    const db = makeDb({ checkins: [], blockers: [] });
    const fakeFetch = vi.fn(async () => new Response("server error", { status: 500 }));
    const res = await onRequestPost({
      env: { DB: db, ANTHROPIC_API_KEY: "sk-test" },
      params: { projectId: "1" },
      fetch: fakeFetch,
    });
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.degraded_reason).toContain("500");
  });

  it("returns 500 when the DB binding is missing", async () => {
    const res = await onRequestPost({ env: {}, params: { projectId: "1" } });
    expect(res.status).toBe(500);
  });

  it("returns 500 when a query throws", async () => {
    const db = makeDb({ throwOn: "FROM checkins" });
    const res = await onRequestPost({
      env: { DB: db },
      params: { projectId: "1" },
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("db boom");
  });
});

describe("AI summarizer — renderSummaryHtml (UI)", () => {
  it("badges model responses as AI-generated", () => {
    const html = renderSummaryHtml({
      summary: "All clear today.",
      source: "anthropic",
      source_counts: { checkins: 4, blockers: 1 },
    });
    expect(html).toContain("All clear today.");
    expect(html).toContain("AI-generated digest");
    expect(html).toContain("4 check-ins · 1 blockers");
  });

  it("badges fallback responses distinctly so users know it's not the model", () => {
    const html = renderSummaryHtml({
      summary: "No check-ins.",
      source: "fallback",
      source_counts: { checkins: 0, blockers: 0 },
    });
    expect(html).toContain("Auto-generated digest");
    expect(html).not.toContain("AI-generated digest");
  });

  it("escapes HTML in summary text to block injection from check-in content", () => {
    const html = renderSummaryHtml({
      summary: "<script>alert(1)</script>",
      source: "fallback",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
