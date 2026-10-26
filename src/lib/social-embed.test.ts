import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEmbed, embedBlockquote } from "./social-embed.ts";

test("parseEmbed recognises lone social URLs", () => {
  assert.equal(parseEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  assert.equal(parseEmbed("https://youtu.be/dQw4w9WgXcQ?t=42")?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=42");
  assert.equal(parseEmbed("https://youtube.com/shorts/abcDEF12345")?.aspect, "9/16");
  assert.equal(parseEmbed("<https://x.com/elonmusk/status/1234567890123>")?.url, "https://twitter.com/elonmusk/status/1234567890123");
  assert.equal(parseEmbed("[Watch](https://www.instagram.com/reel/Cx1_ab-/)")?.url, "https://www.instagram.com/reel/Cx1_ab-/");
  assert.equal(parseEmbed("https://www.tiktok.com/@some.user/video/7234567890123456789")?.provider, "tiktok");
  assert.equal(parseEmbed("https://www.threads.net/@zuck/post/C8abc_1")?.provider, "threads");
  assert.equal(parseEmbed("https://vimeo.com/76979871")?.src, "https://player.vimeo.com/video/76979871?dnt=1");
  assert.equal(parseEmbed("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")?.aspect, "audio");
  assert.equal(parseEmbed("https://www.facebook.com/page/videos/123456/")?.provider, "facebook");
});

test("parseEmbed ignores inline links and unknown hosts", () => {
  assert.equal(parseEmbed("See https://x.com/a/status/1234567890 for more."), null);
  assert.equal(parseEmbed("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseEmbed("https://x.com/elonmusk"), null);
  assert.equal(parseEmbed("javascript:alert(1)"), null);
});

test("blockquote markup is escaped and has a fallback link", () => {
  const html = embedBlockquote(parseEmbed("https://x.com/a_b/status/1234567890")!, "dark");
  assert.match(html, /class="twitter-tweet"[^>]*data-theme="dark"/);
  assert.match(html, /href="https:\/\/twitter.com\/a_b\/status\/1234567890"/);
  assert.doesNotMatch(html, /<script/);
});
