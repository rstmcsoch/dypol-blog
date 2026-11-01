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
