/** t195–t197: system-wide sharing settings, per-platform formatting, link-card meta. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHARE_BUTTONS, nativeShareData, normalizeShareSettings, shareCopyText, shareHref, shareHrefFor } from "./share-buttons.ts";
import { composeShare, defaultShareConfig, joinShare, normalizeShareConfig, shareConfigProblems, shareLinkFor, type ShareConfig } from "./share-config.ts";
import { NETWORK_DEFAULT_FORMAT, formatShareText, stripFormatting } from "./share-format.ts";
import { articleSocialMeta, shareImagePath, socialMeta } from "./seo.ts";
import { parseSite } from "../content/validate.ts";
import { site as defaults } from "../content/site.ts";

const subject = { title: "Apple & Google: 50% off?", slug: "a-b", path: "/articles/a-b", excerpt: "Short summary.", author: "Ann" };
const url = "https://blog.dypol.workers.dev/articles/a-b";
const ctx = { canonicalUrl: url, siteName: "DYPOL BLOG", publisher: "DYPOL LABS" };
const cfg = (patch: (c: ShareConfig) => void = () => {}) => { const c = defaultShareConfig(); patch(c); return c; };
const STYLED = /[\u{1D400}-\u{1D7FF}]|\u0332|\u0336/u;

test("default settings produce exactly the old share URLs for every built-in button", () => {
  for (const b of DEFAULT_SHARE_BUTTONS) {
    if (b.kind === "copy" || b.kind === "native") continue;
    assert.equal(shareHrefFor(b, defaultShareConfig(), subject, ctx), shareHref(b, url, subject.title), b.kind);
  }
  assert.equal(shareCopyText(defaultShareConfig(), subject, ctx), url);
  assert.deepEqual(nativeShareData(defaultShareConfig(), subject, ctx), { title: subject.title, url });
});

test("WhatsApp gets WhatsApp's own markup; underline has no WhatsApp form and stays plain", () => {
  assert.equal(formatShareText("<b>Hi</b> <i>there</i> <c>x</c> <s>no</s> <u>u</u> <bi>both</bi>", "whatsapp"), "*Hi* _there_ `x` ~no~ u *_both_*");
  assert.equal(formatShareText("<c>line1<br>line2</c>", "whatsapp"), "```line1\nline2```");
});

test("Telegram gets the app's typed shortcuts (**bold** __italic__ ~~strike~~ `mono`)", () => {
  assert.equal(formatShareText("<b>Hi</b> <i>there</i> <c>x</c> <s>no</s> <u>u</u>", "telegram"), "**Hi** __there__ `x` ~~no~~ u");
});

test("Discord markdown and Slack mrkdwn for custom buttons", () => {
  assert.equal(formatShareText("<b>a</b> <i>b</i> <u>c</u> <s>d</s> <c>e</c>", "markdown"), "**a** *b* __c__ ~~d~~ `e`");
  assert.equal(formatShareText("<b>a</b> <i>b</i> <u>c</u> <s>d</s> <c>e</c>", "slack"), "*a* _b_ c ~d~ `e`");
});

test("platforms without formatting get clean plain text — never Unicode look-alike letters by default", () => {
  const c = cfg((x) => { x.message.template = "<b>{title}</b> <i>by</i> <u>{author}</u> <c>x</c> <s>old</s> <q>new</q>"; });
  for (const network of Object.keys(NETWORK_DEFAULT_FORMAT)) {
    const out = joinShare(composeShare(c, subject, network, ctx));
    assert.ok(!STYLED.test(out), `${network}: ${out}`);
    assert.ok(!/<\/?(b|i|u|c|s|q)>/.test(out), `${network} keeps no tags`);
  }
  assert.equal(composeShare(c, subject, "x", ctx).text, "Apple & Google: 50% off? by Ann x old “new”");
  assert.equal(NETWORK_DEFAULT_FORMAT.x, "plain");
  assert.equal(NETWORK_DEFAULT_FORMAT.whatsapp, "whatsapp");
  assert.equal(NETWORK_DEFAULT_FORMAT.telegram, "telegram");
});

test("Unicode look-alike letters only when the admin explicitly picks them", () => {
  const c = cfg((x) => { x.message.template = "<b>Bold</b>"; x.networks.x = { ...x.networks.x, template: "", includeLink: "inherit", hashtags: "inherit", extraLinks: "inherit", utm: "inherit", utmSource: "", format: "unicode" }; });
  assert.equal(composeShare(c, subject, "x", ctx).text, "𝗕𝗼𝗹𝗱");
});

test("URLs, #hashtags and @handles inside styled text are never styled or wrapped", () => {
  assert.equal(formatShareText("<b>Read https://ex.com/a_b*c #ai_news @dypol now</b>", "whatsapp"), "*Read* https://ex.com/a_b*c #ai_news @dypol *now*");
  assert.equal(formatShareText("<b>Read https://ex.com/x #ai</b>", "unicode"), "𝗥𝗲𝗮𝗱 https://ex.com/x #ai");
  const c = cfg((x) => { x.message.hashtags = ["ai", "tech_news"]; x.message.template = "<b>{title}</b>"; });
  const wa = joinShare(composeShare(c, subject, "whatsapp", ctx));
  assert.equal(wa, "*Apple & Google: 50% off?* #ai #tech_news " + url);
});

test("tags inside article values are shown literally, not applied", () => {
  const c = cfg((x) => { x.message.template = "{title}"; });
  assert.equal(composeShare(c, { ...subject, title: "Why <b> matters" }, "whatsapp", ctx).text, "Why <b> matters");
});

test("prefix, suffix, separator, extra links, link toggle and per-app overrides", () => {
  const c = cfg((x) => {
    x.message.prefix = "New:"; x.message.suffix = "Via {site}"; x.message.separator = "newline";
    x.message.extraLinks = [{ label: "Newsletter", url: "https://ex.com/n" }];
    x.networks.whatsapp = { template: "<b>{title}</b> — {excerpt}", includeLink: "inherit", hashtags: "off", extraLinks: "off", utm: "inherit", utmSource: "", format: "inherit" };
  });
  assert.equal(joinShare(composeShare(c, subject, "whatsapp", ctx)), `New:\n*Apple & Google: 50% off?* — Short summary.\nVia DYPOL BLOG\n${url}`);
  assert.equal(joinShare(composeShare(c, subject, "threads", ctx)), `New:\nApple & Google: 50% off?\nVia DYPOL BLOG\nNewsletter: https://ex.com/n\n${url}`);
  assert.ok(shareHrefFor({ kind: "reddit", template: "" }, c, subject, ctx)!.endsWith(`&title=${encodeURIComponent("New: Apple & Google: 50% off? Via DYPOL BLOG")}`), "title fields are one line");
  assert.ok(shareHrefFor({ kind: "email", template: "" }, c, subject, ctx)!.startsWith(`mailto:?subject=${encodeURIComponent("New: Apple & Google: 50% off? Via DYPOL BLOG")}&`));
  const noLink = cfg((x) => { x.message.includeLink = false; });
  assert.equal(joinShare(composeShare(noLink, subject, "whatsapp", ctx)), subject.title);
  assert.ok(shareHrefFor({ kind: "facebook", template: "" }, noLink, subject, ctx)!.includes(encodeURIComponent(url)), "Facebook always gets the link");
});

test("UTM tags go on the shared link only, per network, never on og:url", () => {
  const c = cfg((x) => { x.link.utm.enabled = true; });
  assert.equal(shareLinkFor(c, url, "whatsapp", subject), `${url}?utm_source=whatsapp&utm_medium=social&utm_campaign=share`);
  const meta = articleSocialMeta({ origin: "https://blog.dypol.workers.dev", site: { ...defaults, share: c }, article: { id: "1", slug: "a-b", title: "T", excerpt: "E", publishedAt: null, updatedAt: "2026-01-01" }, path: "/articles/a-b", title: "T | S", description: "D", topics: [] });
  assert.equal(meta.find((m) => m.property === "og:url")?.content, url);
});

test("copy link 'text' mode and the share menu carry the configured text", () => {
  const c = cfg((x) => { x.link.copyMode = "text"; x.message.template = "<b>{title}</b>!"; });
  assert.equal(shareCopyText(c, subject, ctx), `${subject.title}! ${url}`);
  assert.deepEqual(nativeShareData(c, subject, ctx), { title: subject.title, url, text: `${subject.title}!` });
});

test("link card meta: defaults equal the old tags; templates strip tags; handle and card type", () => {
  const base = { origin: "https://blog.dypol.workers.dev", article: { id: "1", slug: "a-b", title: "T", excerpt: "E", coverMediaId: "m1", coverAlt: "alt", publishedAt: "2026-01-01", updatedAt: "2026-01-02" }, path: "/articles/a-b", title: "T | S", description: "D", topics: ["Tech"] };
  const old = socialMeta({ title: "T | S", description: "D", url, type: "article", siteName: defaults.name, image: "https://blog.dypol.workers.dev/media/m1", publishedAt: "2026-01-01", modifiedAt: "2026-01-02", section: "Tech", imageAlt: "alt" });
  assert.deepEqual(articleSocialMeta({ ...base, site: { ...defaults, share: defaultShareConfig() } }), old);
  const c = cfg((x) => { x.meta.titleTemplate = "<b>{title}</b> — {site}"; x.meta.twitterCard = "summary"; x.meta.articleTimes = false; });
  const m = articleSocialMeta({ ...base, site: { ...defaults, share: c } });
  assert.equal(m.find((e) => e.property === "og:title")?.content, `T — ${defaults.name}`);
  assert.equal(m.find((e) => e.name === "twitter:card")?.content, "summary");
  assert.ok(!m.some((e) => e.property === "article:published_time"));
});

test("branded image path versions with the image/logo/placement; falls back without a logo", () => {
  const site = { ...defaults, logoMediaId: "logo1", share: cfg((x) => { x.image.source = "branded"; }) };
  const a = shareImagePath(site, { id: "1", coverMediaId: "c1" });
  assert.match(a, /^\/share-image\/c1\.jpg\?v=[0-9a-f]{8}$/);
  const moved = shareImagePath({ ...site, share: cfg((x) => { x.image.source = "branded"; x.image.position = "top-left"; }) }, { id: "1", coverMediaId: "c1" });
  assert.notEqual(a, moved);
  assert.equal(shareImagePath({ ...site, logoMediaId: null }, { id: "1", coverMediaId: "c1" }), "/media/c1");
});

test("validation: unknown placeholder, unclosed tag, bad extra link, bad X handle", () => {
  const c = cfg((x) => { x.message.template = "<b>{titel}"; x.message.extraLinks = [{ label: "", url: "javascript:alert(1)" }]; x.meta.twitterSite = "bad handle!"; });
  const messages = shareConfigProblems(c).map((p) => p.message).join(" | ");
  assert.match(messages, /unknown placeholder \{titel\}/);
  assert.match(messages, /<b> is not closed/);
  assert.match(messages, /Extra link 1/);
  assert.match(messages, /X handle/);
  assert.deepEqual(shareConfigProblems(defaultShareConfig()), []);
});

test("stored settings: tolerant normalize; buttons kept; older callers sending only buttons still save", () => {
  assert.deepEqual(normalizeShareConfig({ message: { template: 5 }, image: { size: 999 } }).image.size, 50);
  assert.equal(normalizeShareConfig(null).message.template, "{title}");
  const custom = [{ id: "share-x", kind: "x", enabled: true, label: "Post", template: "" }];
  assert.deepEqual(normalizeShareSettings({ buttons: custom }).buttons, custom);
  const saved = parseSite({ ...defaults, share: { buttons: custom } });
  assert.deepEqual(saved.share.buttons, custom);
  assert.equal(saved.share.message.template, "{title}");
  assert.throws(() => parseSite({ ...defaults, share: { buttons: custom, message: { template: "<b>{nope}</b>" } } }), /unknown placeholder/);
});

test("stripFormatting keeps the words", () => {
  assert.equal(stripFormatting("<b>a</b><br><i>b</i>"), "a\nb");
});
