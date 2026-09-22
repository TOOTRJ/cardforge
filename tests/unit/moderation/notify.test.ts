import { describe, expect, it } from "vitest";
import { escapeSlackText } from "@/lib/moderation/notify";

// The report's free-text note is interpolated into a Slack mrkdwn message.
// Unescaped, a reporter could plant a clickable link or an @channel mention
// in the admin channel.
describe("escapeSlackText", () => {
  it("neutralises the three mrkdwn control characters", () => {
    expect(escapeSlackText("<https://evil.example|click me> & <!channel>")).toBe(
      "&lt;https://evil.example|click me&gt; &amp; &lt;!channel&gt;",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(escapeSlackText("Looks like stolen art — see the artist's page")).toBe(
      "Looks like stolen art — see the artist's page",
    );
  });
});
