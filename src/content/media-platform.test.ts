import assert from "node:assert/strict";
import test, { after } from "node:test";
import { closeDeclaredBindings, openDeclaredBindings } from "./media-platform.server.ts";

const id = "22222222-2222-4222-8222-222222222222";

after(async () => {
  await closeDeclaredBindings();
});

test("declared MEDIA and DB bindings store the file and only a row", async () => {
  const env = await openDeclaredBindings();
  const key = `media/${id}`;
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await env.DB.prepare(
    `create table if not exists media (
      id text primary key,
      object_key text not null unique,
      filename text not null,
      mime text not null,
      alt text not null default '',
      byte_size integer not null,
      created_at text not null
    )`,
  ).run();
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(
    "insert into media (id, object_key, filename, mime, alt, byte_size, created_at) values (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, key, "mark.png", "image/png", "Orange test mark", bytes.byteLength, "2026-10-06T10:00:00.000Z")
    .run();

  const object = await env.MEDIA.get(key);
  assert.ok(object?.arrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(await object.arrayBuffer())), Array.from(bytes));
  assert.equal(object.httpMetadata?.contentType, "image/png");
  const rows = await env.DB.prepare("select id, object_key, filename, byte_size from media where id = ?").bind(id).all<{
    id: string;
    object_key: string;
    filename: string;
    byte_size: number;
    bytes?: Uint8Array;
  }>();
  assert.equal(rows.results?.length, 1);
  assert.equal(rows.results?.[0]?.object_key, key);
  assert.equal(rows.results?.[0]?.filename, "mark.png");
  assert.equal(Number(rows.results?.[0]?.byte_size), 4);
  assert.equal(rows.results?.[0]?.bytes, undefined);

  await env.MEDIA.delete(key);
  await env.DB.prepare("delete from media where id = ?").bind(id).run();
  assert.equal(await env.MEDIA.get(key), null);
});
