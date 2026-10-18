import assert from "node:assert/strict";
import test from "node:test";

import { plural } from "../lib/plural.ts";
import { csvDelimiter, csvField, csvRecords } from "../lib/csv.ts";
import { tidyPasted } from "../lib/paste.ts";

test("plural склоняет по последним цифрам", () => {
  const p = (n: number) => plural(n, "цепочка", "цепочки", "цепочек");
  assert.deepEqual(
    [1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(p),
    ["цепочка", "цепочки", "цепочек", "цепочек", "цепочек", "цепочка", "цепочки", "цепочек", "цепочка", "цепочек"]
  );
});

test("csvRecords понимает кавычки, запятые и переводы строк внутри поля", () => {
  const text = 'city,note\r\n"Москва, Тверская","сказал ""да"""\n\n spb , "две\nстроки"\n';
  assert.deepEqual(csvRecords(text), [
    ["city", "note"],
    ["Москва, Тверская", 'сказал "да"'],
    ["spb", "две\nстроки"],
  ]);
});

test("csvRecords делит строку по точке с запятой", () => {
  assert.equal(csvDelimiter("login;password\n"), ";");
  assert.deepEqual(csvRecords("login;password\nu1;p1\n"), [
    ["login", "password"],
    ["u1", "p1"],
  ]);
  assert.deepEqual(csvRecords('a;b\n"x;y";z\n'), [
    ["a", "b"],
    ["x;y", "z"],
  ]);
});

test("tidyPasted убирает скрытые символы и форматирует JSON", () => {
  const raw = '{\u00A0"a":\u200B1,"b":[2]}';
  const tidied = tidyPasted(raw);
  assert.equal(tidied.formatted, true);
  assert.equal(tidied.text, '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
  assert.equal(tidyPasted("https://host/a\u00A0").text, "https://host/a ");
});

test("csvField экранирует так, что csvRecords читает обратно то же", () => {
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('q"x'), '"q""x"');
  assert.equal(csvField("plain"), "plain");
  const row = ["a,b", 'q"x', "line\nbreak", "plain"];
  assert.deepEqual(csvRecords(row.map(csvField).join(",")), [row]);
});
