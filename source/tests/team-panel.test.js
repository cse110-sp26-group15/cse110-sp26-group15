import { describe, it, expect } from "vitest";
import { buildTeamPanelHtml } from "../shared/team-panel.js";

describe("buildTeamPanelHtml", () => {
  it("renders members with name and email", () => {
    const html = buildTeamPanelHtml({
      members: [{ user_id: 1, full_name: "Alex Rivera", email: "a@x.com", role: "Lead" }],
      pending_invites: [],
    });
    expect(html).toContain("Alex Rivera");
    expect(html).toContain("a@x.com");
  });

  it("tags pending invites", () => {
    const html = buildTeamPanelHtml({
      members: [],
      pending_invites: [{ email: "ghost@x.com" }],
    });
    expect(html).toContain("ghost@x.com");
    expect(html).toMatch(/Pending/i);
  });

  it("escapes HTML in names", () => {
    const html = buildTeamPanelHtml({
      members: [{ user_id: 1, full_name: "<script>", email: "a@x.com" }],
      pending_invites: [],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
