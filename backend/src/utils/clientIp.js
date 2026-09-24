const net = require("net");

// Client IP for rate limiting only (never for authorization).
//
// On Vercel every request reaches the function through the platform's edge,
// which sets x-vercel-forwarded-for / x-real-ip / x-forwarded-for itself
// (client-supplied values are overwritten, so they can be trusted THERE). The
// socket address on Vercel is an internal proxy address shared by everyone, so
// it must never be used as a client identity. Everywhere else (local dev,
// tests) the forwarded headers are NOT trusted — anyone could send them — and
// the socket address is used instead.
//
// Deliberately not app.set("trust proxy"): only this helper reads proxy
// headers, and only when running on Vercel.

const VERCEL_HEADER_ORDER = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"];

function stripDecorations(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";

  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    value = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.replace(/:\d+$/, "");
  }

  const zone = value.indexOf("%");
  if (zone > -1) value = value.slice(0, zone);

  return value;
}

// -> { family: 4 | 6, address } or null when it is not a valid IP.
function parseIp(raw) {
  const value = stripDecorations(raw);
  const family = net.isIP(value);
  if (!family) return null;

  if (family === 6) {
    const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped && net.isIPv4(mapped[1])) return { family: 4, address: mapped[1] };
    return { family: 6, address: value.toLowerCase() };
  }

  return { family: 4, address: value };
}

function expandIpv6(address) {
  let value = address.toLowerCase();

  const embeddedV4 = value.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedV4) {
    const octets = embeddedV4[2].split(".").map(Number);
    value = `${embeddedV4[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = value.split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length > 1 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;

  return groups.map((group) => group.padStart(4, "0"));
}

// Stable bucket identity: IPv4 as-is, IPv6 grouped by /64 (one subscriber /
// household commonly owns a whole /64, and rotates addresses inside it).
function ipKey(parsed) {
  if (!parsed) return null;
  if (parsed.family === 4) return `v4:${parsed.address}`;
  return `v6:${expandIpv6(parsed.address).slice(0, 4).join(":")}/64`;
}

function firstValidFromHeaders(headers) {
  for (const name of VERCEL_HEADER_ORDER) {
    const raw = headers[name];
    if (!raw) continue;

    for (const candidate of String(raw).split(",")) {
      const parsed = parseIp(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

// Returns { family, address } or null (unknown). `trustProxyHeaders` defaults
// to "are we on Vercel"; tests override it.
function getClientIp(req, { trustProxyHeaders } = {}) {
  const trust = trustProxyHeaders === undefined ? Boolean(process.env.VERCEL) : trustProxyHeaders;

  if (trust) {
    // On Vercel with no usable header, return "unknown" rather than falling
    // back to the shared internal socket address.
    return firstValidFromHeaders((req && req.headers) || {});
  }

  const socketAddress = req && ((req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress));
  return parseIp(socketAddress);
}

function getClientIpKey(req, options) {
  return ipKey(getClientIp(req, options));
}

module.exports = { getClientIp, getClientIpKey, parseIp, ipKey, expandIpv6 };
