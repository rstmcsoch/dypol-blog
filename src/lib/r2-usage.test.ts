import assert from "node:assert/strict";
import test from "node:test";
import {
  R2_INCLUDED_STORAGE_BYTES,
  formatByteSize,
  formatExactBytes,
  formatMeasuredIst,
  formatShare,
  istCalendarDay,
  parseQuotaBytes,
  reconcileListing,
  sharePercent,
  sumObjectSizes,
  listEntireBucket,
} from "./r2-usage.ts";

test("sums object sizes and refuses a partial or corrupt total", () => {
  assert.deepEqual(sumObjectSizes([{ size: 32276 }, { size: 9256 }, { size: 0 }]), {
    bytes: 41532,
    count: 3,
  });
  assert.throws(() => sumObjectSizes([{ size: 1.5 }]));
  assert.throws(() => sumObjectSizes([{ size: -1 }]));
});

test("formats decimal bytes the way R2 bills them", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(9509600), "9.51 MB");
  assert.equal(formatByteSize(R2_INCLUDED_STORAGE_BYTES), "10 GB");
  assert.equal(formatExactBytes(9509600), "9,509,600 bytes");
});

test("share of the 10 GB allowance stays honest at small usage", () => {
  assert.equal(formatShare(9509600, R2_INCLUDED_STORAGE_BYTES), "0.10%");
  assert.equal(formatShare(1, R2_INCLUDED_STORAGE_BYTES), "<0.01%");
  assert.equal(formatShare(0, R2_INCLUDED_STORAGE_BYTES), "0.00%");
  assert.ok(Math.abs(sharePercent(9509600, R2_INCLUDED_STORAGE_BYTES) - 0.095096) < 1e-6);
});

test("quota override must be a positive integer", () => {
  assert.equal(parseQuotaBytes(undefined), R2_INCLUDED_STORAGE_BYTES);
  assert.equal(parseQuotaBytes(" 5000000000 "), 5_000_000_000);
  assert.equal(parseQuotaBytes("10GB"), R2_INCLUDED_STORAGE_BYTES);
  assert.equal(parseQuotaBytes("0"), R2_INCLUDED_STORAGE_BYTES);
});

test("IST day rolls at midnight Kolkata, not UTC", () => {
  assert.equal(istCalendarDay(new Date("2026-10-25T18:29:00.000Z")), "2026-10-25");
  assert.equal(istCalendarDay(new Date("2026-10-25T18:30:00.000Z")), "2026-10-26");
  assert.match(formatMeasuredIst("2026-10-26T06:10:00.000Z"), /26 Oct 2026, 11:40 IST/);
});

test("analytics cross-check only matches an identical byte count", () => {
  assert.equal(reconcileListing(9509600, 9509600), "match");
  assert.equal(reconcileListing(9509600, 9509601), "lag");
  assert.equal(reconcileListing(9509600, null), "unchecked");
});

test("a full listing sums every page and a partial listing is refused", async () => {
  let page = 0;
  const complete = await listEntireBucket({
    async list() {
      page += 1;
      if (page === 1) return { objects: [{ size: 100 }], truncated: true, cursor: "next" };
      return { objects: [{ size: 50 }, { size: 25 }], truncated: false };
    },
  });
  assert.deepEqual(complete, { bytes: 175, count: 3 });
  await assert.rejects(
    listEntireBucket({
      async list() {
        return { objects: [{ size: 10 }], truncated: true };
      },
    }),
    /stopped early/,
  );
  await assert.rejects(
    listEntireBucket({
      async list() {
        return { truncated: false } as { objects: { size: number }[]; truncated: boolean };
      },
    }),
    /no object list/,
  );
});
