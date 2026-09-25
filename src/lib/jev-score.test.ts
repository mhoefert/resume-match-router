import { test } from "node:test";
import assert from "node:assert/strict";
import { compositeFit, deriveReuse } from "./jev/contract.ts";

const top = {
  function_fit: 1,
  seniority_fit: 1,
  domain_fit: 1,
  must_have_coverage: 1,
};

test("composite fit is a weighted 0-100 sum", () => {
  assert.equal(compositeFit(top), 100);
  assert.equal(
    compositeFit({ function_fit: 0, seniority_fit: 0, domain_fit: 0, must_have_coverage: 0 }),
    0
  );
  assert.equal(
    compositeFit({ function_fit: 1, seniority_fit: 0, domain_fit: 0, must_have_coverage: 0 }),
    35
  );
});

test("reuse is derived from dimensions and the blocker gate", () => {
  assert.equal(deriveReuse({ ...top, blocker: true }), "reject_unfit");
  assert.equal(deriveReuse({ ...top, blocker: false }), "reuse_as_is");
  assert.equal(
    deriveReuse({
      function_fit: 0.7,
      seniority_fit: 0.4,
      domain_fit: 0.2,
      must_have_coverage: 0.7,
      blocker: false,
    }),
    "light_keyword_pass"
  );
  assert.equal(
    deriveReuse({
      function_fit: 0.2,
      seniority_fit: 0.2,
      domain_fit: 0.2,
      must_have_coverage: 0.2,
      blocker: false,
    }),
    "reject_unfit"
  );
});
