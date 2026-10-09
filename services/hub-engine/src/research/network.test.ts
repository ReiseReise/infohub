import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, publicUrl, authorizeSearch } from "./network.js";
test("deny private, loopback, mapped IPv6 and transition addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("deny nonpublic URL capabilities", () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.org/a",
    "http://user:pass@example.org",
    "https://example.org:3001",
  ])
    assert.throws(() => publicUrl(url), /url_denied/);
});
test("network-disabled tasks cannot search even approved terms", () =>
  assert.throws(
    () => authorizeSearch(false, ["OpenAI"], "OpenAI"),
    /network_disabled/,
  ));
test("search cannot exfiltrate arbitrary guidance or credentials", () => {
  assert.doesNotThrow(() => authorizeSearch(true, ["公开产品"], "公开产品"));
  for (const q of ["私人会议记录", "API_KEY=secret", "user@example.org"])
    assert.throws(
      () => authorizeSearch(true, ["公开产品"], q),
      /not_authorized/,
    );
});

test('explicit search allowlist still rejects synthetic sensitive values before any request',()=>{
 for(const q of ['sk-syntheticKey12345678','Bearer synthetic-access-token','API_KEY:synthetic','token = synthetic','密码：测试值','联系13800000000','身份证11010119900101001X','/Users/test/private-notes','eyJtest.eyJdata.synthetic','test@example.invalid']) {
  assert.throws(()=>authorizeSearch(true,[q],q),/search_terms_not_authorized/,q);
 }
 for(const q of ['DeepSeek V4.1 Flash 2026-09-14','GPT-6 API pricing'])assert.doesNotThrow(()=>authorizeSearch(true,[q],q));
});
