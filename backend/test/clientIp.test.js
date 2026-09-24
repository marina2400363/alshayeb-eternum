// Client IP helper: trusted proxy headers on Vercel only, first VALID address,
// IPv6 grouped by /64, safe fallbacks. Pure unit tests (no server, no database).

const test = require("node:test");
const assert = require("node:assert/strict");

const { getClientIp, getClientIpKey, parseIp, ipKey } = require("../src/utils/clientIp");

const req = (headers = {}, remoteAddress) => ({ headers, socket: remoteAddress ? { remoteAddress } : {} });
const onVercel = { trustProxyHeaders: true };

test("forwarded IPv4 (Vercel): x-vercel-forwarded-for wins, then x-real-ip, then x-forwarded-for", () => {
  assert.equal(getClientIpKey(req({ "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }), onVercel), "v4:203.0.113.7");
  assert.equal(getClientIpKey(req({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "192.0.2.5" }), onVercel), "v4:198.51.100.1");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "192.0.2.5" }), onVercel), "v4:192.0.2.5");
});

test("takes the FIRST VALID address from a forwarded list, skipping junk", () => {
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" }), onVercel), "v4:203.0.113.9");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "unknown, not-an-ip, 203.0.113.9" }), onVercel), "v4:203.0.113.9");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": " 203.0.113.9 ,10.0.0.1" }), onVercel), "v4:203.0.113.9");
});

test("strips ports and brackets", () => {
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "203.0.113.9:51234" }), onVercel), "v4:203.0.113.9");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "[2001:db8:abcd:12::1]:443" }), onVercel), "v6:2001:0db8:abcd:0012/64");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "[2001:db8:abcd:12::1]" }), onVercel), "v6:2001:0db8:abcd:0012/64");
});

test("IPv6 is grouped by /64: same subscriber /64 -> same key, different /64 -> different key", () => {
  const a = getClientIpKey(req({ "x-vercel-forwarded-for": "2001:db8:abcd:12::1" }), onVercel);
  const b = getClientIpKey(req({ "x-vercel-forwarded-for": "2001:0db8:abcd:0012:ffff:eeee:dddd:cccc" }), onVercel);
  const c = getClientIpKey(req({ "x-vercel-forwarded-for": "2001:db8:abcd:13::1" }), onVercel);
  assert.equal(a, "v6:2001:0db8:abcd:0012/64");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(ipKey(parseIp("::1")), "v6:0000:0000:0000:0000/64");
});

test("IPv4-mapped IPv6 collapses to the IPv4 address; zone ids are dropped", () => {
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "::ffff:203.0.113.9" }), onVercel), "v4:203.0.113.9");
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "fe80::1%eth0" }), onVercel), "v6:fe80:0000:0000:0000/64");
});

test("malformed or missing headers on Vercel -> unknown (null), NEVER the shared socket address", () => {
  assert.equal(getClientIp(req({}, "10.0.0.99"), onVercel), null);
  assert.equal(getClientIp(req({ "x-forwarded-for": "garbage" }, "10.0.0.99"), onVercel), null);
  assert.equal(getClientIp(req({ "x-forwarded-for": "999.999.1.1, 1.2.3" }, "10.0.0.99"), onVercel), null);
  assert.equal(getClientIp(req({ "x-forwarded-for": "" }, "10.0.0.99"), onVercel), null);
  assert.equal(getClientIp({}, onVercel), null);
});

test("off Vercel the forwarded headers are NOT trusted (spoofable) and the socket address is used", () => {
  const off = { trustProxyHeaders: false };
  assert.equal(getClientIpKey(req({ "x-forwarded-for": "203.0.113.9" }, "127.0.0.1"), off), "v4:127.0.0.1");
  assert.equal(getClientIpKey(req({ "x-vercel-forwarded-for": "203.0.113.9" }, "::ffff:127.0.0.1"), off), "v4:127.0.0.1");
  assert.equal(getClientIp(req({ "x-forwarded-for": "203.0.113.9" }), off), null);
  assert.equal(getClientIp({}, off), null);
});

test("default trust follows process.env.VERCEL", () => {
  const original = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.equal(getClientIpKey(req({ "x-forwarded-for": "203.0.113.9" }, "127.0.0.1")), "v4:127.0.0.1");
    process.env.VERCEL = "1";
    assert.equal(getClientIpKey(req({ "x-forwarded-for": "203.0.113.9" }, "127.0.0.1")), "v4:203.0.113.9");
  } finally {
    if (original === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original;
  }
});
