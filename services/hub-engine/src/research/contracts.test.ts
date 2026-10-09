import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  validateDraft,
  fingerprint,
  reserveAllowed,
} from "./contracts.js";
const sid = "00000000-0000-4000-8000-000000000001",
  cid = "00000000-0000-4000-8000-000000000002";
const sources = [
  {
    id: sid,
    title: "原文",
    url: "https://example.org",
    body: "发布日期为9月6日。",
    content_hash: "hash",
  },
];
const citations = [
  {
    id: cid,
    source_id: sid,
    quote: "发布日期为9月6日。",
    start_offset: 0,
    end_offset: 10,
  },
];
test("facts require explicit citations", () =>
  assert.equal(
    draftSchema.safeParse({
      title: "稿",
      facts: [{ text: "事实", citations: [] }],
      analysis: [],
      unresolved: [],
    }).success,
    false,
  ));
test("citations must point to exact preserved source text", () => {
  const draft = {
    title: "稿",
    facts: [{ text: "事实", citations: [cid] }],
    analysis: [],
    unresolved: [],
  };
  assert.deepEqual(validateDraft(draft, citations, sources), []);
  assert.ok(
    validateDraft(
      draft,
      [{ ...citations[0], quote: "假的日期" }],
      sources,
    ).includes("invalid_evidence"),
  );
});
test("links and placeholders fail closed", () => {
  for (const text of ["见 https://evil.org", "摘要失败", "TIL [Using Blende"])
    assert.ok(
      validateDraft(
        {
          title: "稿",
          facts: [{ text, citations: [cid] }],
          analysis: [],
          unresolved: [],
        },
        citations,
        sources,
      ).includes("unsupported_link_or_placeholder"),
    );
});
test("budget includes reservations and refuses nonfinite or negative values", () => {
  assert.equal(reserveAllowed(10000000, 8000000, 1000000, 1000001), false);
  assert.equal(reserveAllowed(10000000, 8000000, 1000000, 1000000), true);
  assert.equal(reserveAllowed(10, 0, 0, NaN), false);
  assert.equal(reserveAllowed(10, 0, 0, -1), false);
});
test("fingerprint survives PostgreSQL jsonb key reordering", () =>
  assert.equal(
    fingerprint({ a: 1, b: { d: 4, c: 3 } }),
    fingerprint({ b: { c: 3, d: 4 }, a: 1 }),
  ));


test('known draft envelope is strict and extra verifier uncertainty prevents approval',async()=>{
 const {parseRevisedDraft,parseVerification}=await import('./contracts.js');
 const draft={title:'测试',facts:[],analysis:[],unresolved:['未核实']};
 assert.deepEqual(parseRevisedDraft({draft}),draft);
 assert.throws(()=>parseRevisedDraft({draft,unexpected:true}));
 assert.deepEqual(parseVerification({pass:true,issues:[],unresolved:['来源冲突']}),{pass:false,issues:['待核实：来源冲突']});
 assert.throws(()=>parseVerification({pass:true,issues:[],hiddenFact:'不允许丢弃'}));
});
