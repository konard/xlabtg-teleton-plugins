import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("deezer plugin declares ESM module type for standalone installs", async () => {
  const packageJson = JSON.parse(
    await readFile(join(import.meta.dirname, "..", "package.json"), "utf8")
  );

  assert.equal(packageJson.type, "module");
});
