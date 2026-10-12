import assert from "node:assert/strict";
import { test } from "node:test";
import { markdown } from "./markdown.ts";

test("markdown renderiza o texto e não executa HTML de descrição", () => {
  assert.equal(markdown("**rápida** e `código`"), "<p><strong>rápida</strong> e <code>código</code></p>\n");
  const html = markdown(`<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))`);
  assert.doesNotMatch(html, /<script|<img|href="javascript/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
