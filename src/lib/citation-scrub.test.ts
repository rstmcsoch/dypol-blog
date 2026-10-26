import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubCitations, scrubCitationsDeep } from "./citation-scrub.ts";

test("scrubCitations removes leftover AI citation markup", () => {
  assert.equal(scrubCitations('Walker.<grok type="render_inline_citation" citation_id="49" /> Next'), "Walker. Next");
  assert.equal(scrubCitations('film <grok type=\\"render_inline_citation\\" citation_id=\\"30\\" />.'), "film.");
  assert.equal(scrubCitations("a &lt;grok type=&quot;x&quot; /&gt; b"), "a b");
  assert.equal(scrubCitations("fact [cite: 3] and 【4†source】 done"), "fact and done");
  assert.equal(scrubCitations("[cite_start]Kept text[cite_end]"), "Kept text");
  assert.equal(scrubCitations("Plain **text** stays."), "Plain **text** stays.");
});

test("scrubCitationsDeep cleans blocks but not code", () => {
  const out = scrubCitationsDeep([{ type: "paragraph", text: "x <grok a='1'/>." }, { type: "code", code: "<grok />  y" }]);
  assert.deepEqual(out, [{ type: "paragraph", text: "x." }, { type: "code", code: "<grok />  y" }]);
});
