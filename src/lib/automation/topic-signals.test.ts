import assert from "node:assert/strict";
import test from "node:test";
import { topicSignals } from "./topic-signals.ts";

const quantumBody = "Google Quantum AI reported magic state cultivation on the Willow processor. The quantum experiment reduced errors forty-fold, reaching record logical fidelity for T-states. Fault-tolerant quantum computing needs cleaner qubits, and this cultivation method injects a rough state into a patch of the chip and keeps only attempts that pass every check. Larger demonstrations are still required before practical quantum machines arrive.";

test("quantum article filed only under AI: Emerging suggested + review needed", () => {
  const out = topicSignals({ title: "Google Willow Chip Shows Magic State Cultivation Can Cut Quantum Errors 40-Fold", excerpt: "Magic state cultivation on Willow reduced quantum errors.", body: quantumBody }, ["artificial-intelligence-ai-tools"]);
  assert.equal(out.reviewNeeded, true);
  assert.ok(out.suggestedMissing.some((m) => m.slug === "emerging-technology"), JSON.stringify(out));
});

test("robotics article correctly multi-filed: no review flag", () => {
  const body = "NEURA Robotics announced a multimodal foundation model for physical robots. The humanoid uses tactile grippers and joint state to complete long tasks. The robot learns from demonstrations in robot gyms and runs locally on the robot across five embodiments.";
  const out = topicSignals({ title: "NEURA Robotics Launches Neuron AI, a Foundation Model for Physical Robots", body }, ["robotics-science", "artificial-intelligence-ai-tools"]);
  assert.equal(out.reviewNeeded, false);
});

test("chip earnings filed only under AI: chips + business suggested", () => {
  const body = "TSMC reported record quarterly revenue and net income as wafer demand for 3nm and 2nm nodes outran supply. Gross margin reached 66 percent. The foundry raised its full-year revenue forecast; investors welcomed the earnings.";
  const out = topicSignals({ title: "TSMC Posts Record Q3 Profit as AI Chip Demand Keeps Outrunning Supply", body }, ["artificial-intelligence-ai-tools"]);
  assert.equal(out.reviewNeeded, true);
  assert.ok(out.suggestedMissing.some((m) => m.slug === "chips-gaming"));
  assert.ok(out.suggestedMissing.some((m) => m.slug === "funding-tech-business"));
});

test("generic AI tool news filed under AI: no strong other signals, no flag", () => {
  const body = "The assistant now answers longer questions and remembers context across a conversation. The chatbot update rolls out to free users this week, and the AI model is faster at summarising documents.";
  const out = topicSignals({ title: "Chat Assistant Gets a Memory Upgrade", body }, ["artificial-intelligence-ai-tools"]);
  assert.equal(out.reviewNeeded, false);
});
