import { test } from "node:test";
import assert from "node:assert/strict";
import { cmpMirrorNodes, compactHeadBlock, isCmpPath } from "./cmp.ts";

const BLOCK = `<!-- Default -->\n<script>\n  //<![CDATA[\n  gtag('consent', 'default', {});\n  //]]>\n</script>\n\n<!-- Main -->\n<script async type="text/javascript" src="https://clickiocmp.com/t/consent_251053.js"></script>\n<script defer data-cfasync='false' src='https://s.clickiocdn.com/t/251053_wv.js'></script>\n`;

test("compactHeadBlock drops only whitespace between tags", () => {
  const out = compactHeadBlock(BLOCK);
  assert.equal(out, `<!-- Default --><script>\n  //<![CDATA[\n  gtag('consent', 'default', {});\n  //]]>\n</script><!-- Main --><script async type="text/javascript" src="https://clickiocmp.com/t/consent_251053.js"></script><script defer data-cfasync='false' src='https://s.clickiocdn.com/t/251053_wv.js'></script>`);
});

test("mirrors cover every script React would claim (not async+src)", () => {
  const nodes = cmpMirrorNodes(BLOCK);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[1].attrs.src, "https://s.clickiocdn.com/t/251053_wv.js");
});

test("consent code is skipped on private paths", () => {
  assert.ok(isCmpPath("/") && isCmpPath("/articles/x"));
  assert.ok(!isCmpPath("/admin") && !isCmpPath("/admin/ads") && !isCmpPath("/login"));
});

import { headBlock } from "./cmp.ts";
test("head block: consent code first, then cleaned custom head code; mirrors cover style/noscript", () => {
  const b = headBlock(BLOCK, `<meta name="x" content="1"></head><script>window.y=1</script><style>.a{}</style>`);
  assert.ok(b.startsWith(BLOCK.trim()));
  assert.ok(b.endsWith(`<meta name="x" content="1">\n<script>window.y=1</script>\n<style>.a{}</style>`));
  assert.ok(!b.includes("</head>"));
  assert.deepEqual(cmpMirrorNodes(b).map((n) => n.tag), ["script", "script", "script", "style"]);
  assert.equal(headBlock("", ""), "");
  assert.equal(headBlock("  ", `<meta name="v" content="2">`), `<meta name="v" content="2">`);
});
