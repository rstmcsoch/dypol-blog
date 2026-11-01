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
