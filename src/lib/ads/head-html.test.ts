import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeadHtml, reactProps } from "./head-html.ts";

test("parses scripts, meta and link; drops comments and inline handlers", () => {
  const nodes = parseHeadHtml(`<!-- x --><meta name="google-adsense-account" content="ca-pub-1">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1" crossorigin="anonymous" onload="evil()"></script>
<script>window.x = 1 < 2;</script><link rel="preconnect" href="https://a.test" /><div>ignored</div>`);
  assert.deepEqual(nodes.map((n) => n.tag), ["meta", "script", "script", "link"]);
  assert.equal(nodes[1].attrs.async, true);
  assert.equal(nodes[1].attrs.onload, undefined);
  assert.equal(nodes[2].inner, "window.x = 1 < 2;");
  const props = reactProps(nodes[1].attrs);
  assert.equal(props.crossOrigin, "anonymous");
});

import { adOrigins, GOOGLE_AD_ORIGINS } from "./head-html.ts";
test("adOrigins: script/iframe hosts, protocol-relative, Google only with AdSense code", () => {
  const adsterra = `<script>atOptions={}</script><script src="https://www.highrevenueformat.com/k/invoke.js"></script><script src='//pl1.profitableratecpm.com/a.js'></script><a href="https://click.test/x">x</a>`;
  assert.deepEqual(adOrigins([adsterra]), ["https://www.highrevenueformat.com", "https://pl1.profitableratecpm.com"]);
  assert.deepEqual(adOrigins([`<script src="/local.js"></script>`, ""]), []);
  const adsense = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1"></script><ins class="adsbygoogle"></ins>`;
  assert.deepEqual(adOrigins([adsense]), GOOGLE_AD_ORIGINS);
  assert.deepEqual(adOrigins([adsterra, adsterra]).length, 2);
});

import { checkHeadCode } from "./head-html.ts";
test("checkHeadCode keeps head-valid tags verbatim and lists what it drops", () => {
  const r = checkHeadCode(`<!-- gsc --><meta name="google-site-verification" content="abc" />
</head><body><base href="/x"><title>T</title>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script>if (1 < 2) gtag('js', new Date());</script>
<noscript><iframe src="https://www.googletagmanager.com/ns.html"></iframe></noscript>
<noscript><style>.x{}</style></noscript><style>.a > b {}</style>stray <link rel="preconnect" href="https://a.test">`);
  assert.deepEqual(r.tags.map((t) => t.tag), ["meta", "script", "script", "noscript", "style", "link"]);
  assert.equal(r.tags[0].summary, "google-site-verification = abc");
  assert.ok(r.code.startsWith(`<meta name="google-site-verification" content="abc" />\n<script async`));
  assert.ok(r.code.includes("if (1 < 2) gtag('js', new Date());"));
  assert.ok(!/<\/head>|<body>|<base|<title|iframe|stray/.test(r.code));
  for (const d of ["</head>", "<body>", `<base href="/x">`, "<title>", "stray"]) assert.ok(r.dropped.includes(d), d);
  assert.ok(r.dropped.some((d) => d.includes("GTM")));
  assert.deepEqual(checkHeadCode(""), { code: "", tags: [], dropped: [] });
});
