import assert from "node:assert/strict";
import test from "node:test";
import { advanceCursor, clampCursor, computeTopicSelection, DEFAULT_TOPIC_SELECTION } from "./topic-selection.ts";
import { automationSettingsSchema, MAX_TOPIC_IDEAS, normalizeAutomationSettings } from "./settings.ts";

const ideas = ["a", "b", "c", "d", "e", "f", "g", "h"];

test("topic ideas limit is 500 everywhere", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => `Idea ${i}`);
  for (const n of [51, 200, 500]) {
    const parsed = automationSettingsSchema.safeParse({ ...normalizeAutomationSettings({}), topicIdeas: make(n) });
    assert.equal(parsed.success, true, `${n} ideas should save`);
    assert.equal(normalizeAutomationSettings({ topicIdeas: make(n) }).topicIdeas.length, n);
  }
  assert.equal(automationSettingsSchema.safeParse({ ...normalizeAutomationSettings({}), topicIdeas: make(501) }).success, false);
  assert.equal(MAX_TOPIC_IDEAS, 500);
});

test("sequence cursor: step, wrap, clamp after list edit", () => {
  const sel = { ...DEFAULT_TOPIC_SELECTION, mode: "sequence" as const, step: 3 };
  assert.equal(computeTopicSelection(sel, ideas, 0).suggestedIndex, 0);
  assert.equal(advanceCursor(0, 3, ideas.length), 3);
  assert.equal(advanceCursor(3, 3, ideas.length), 6);
  assert.equal(advanceCursor(6, 3, ideas.length), 1); // wraps
  assert.equal(clampCursor(7, 3), 1); // list shortened from 8 to 3
  assert.equal(computeTopicSelection(sel, ideas.slice(0, 3), 7).suggestedTopic, "b");
  assert.equal(computeTopicSelection(sel, [], 5).suggestedTopic, null);
  assert.equal(advanceCursor(0, 3, 0), 0);
});

test("random: always within list, empty list safe", () => {
  const sel = { ...DEFAULT_TOPIC_SELECTION, mode: "random" as const };
  assert.equal(computeTopicSelection(sel, ideas, 0, () => 0).suggestedIndex, 0);
  assert.equal(computeTopicSelection(sel, ideas, 0, () => 0.999).suggestedIndex, ideas.length - 1);
  for (let i = 0; i < 50; i++) {
    const s = computeTopicSelection(sel, ideas, 0);
    assert.ok(s.suggestedIndex !== null && s.suggestedIndex >= 0 && s.suggestedIndex < ideas.length);
  }
  assert.equal(computeTopicSelection(sel, [], 0).suggestedTopic, null);
});
