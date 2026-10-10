import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent as HttpAgent, request } from "undici";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { ResearchError } from "./store.js";

const blocked = new BlockList();
const blocked6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked6.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string) {
  const kind = isIP(address);
  return (
    Boolean(kind) &&
    !(kind === 6 ? blocked6 : blocked).check(
      address,
      kind === 6 ? "ipv6" : "ipv4",
    )
  );
}
export function publicUrl(value: string) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new ResearchError("url_denied", 403);
  return u;
}
export function authorizeSearch(
  network: boolean,
  allowed: string[],
  query: string,
) {
  if (!network) throw new ResearchError("network_disabled", 403);
  if (
    !allowed.includes(query) ||
    query.length > 160 ||
    /[\r\n@]|\bsk-[a-z0-9_-]{8,}|(?:api[_-]?key|password|token|密钥|密码)\s*[=：:]|\bBearer\s+\S+|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|\b1[3-9]\d{9}\b|\b\d{17}[\dX]\b|\/(?:Users|home)\//i.test(query)
  )
    throw new ResearchError("search_terms_not_authorized", 403);
}
export async function fetchPublic(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
) {
  let current = publicUrl(url);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const hostname = current.hostname.replace(/^\[|\]$/g, "");
    const ips = await lookup(hostname, { all: true });
    if (!ips.length || ips.some((ip) => !isPublicAddress(ip.address)))
      throw new ResearchError("private_address_denied", 403);
    // Pin validated DNS results to the socket. Redirects repeat the same validation.
    const dispatcher = new HttpAgent({
      connect: {
        lookup: ((_host: unknown, options: unknown, callback: unknown) => {
          const cb = callback as (
            err: Error | null,
            address: unknown,
            family?: number,
          ) => void;
          if ((options as { all?: boolean })?.all) cb(null, ips);
          else cb(null, ips[0].address, ips[0].family);
        }) as never,
      },
    });
    try {
      const r = await request(current, {
        dispatcher,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: { "user-agent": "InfoHubResearch/1.0", ...headers },
        headersTimeout: 20000,
        bodyTimeout: 20000,
      });
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
        const location = r.headers.location;
        r.body.destroy();
        if (!location || redirect === 3)
          throw new ResearchError("redirect_limit");
        if (Object.keys(headers).length)
          throw new ResearchError("credential_redirect_denied", 403);
        current = publicUrl(new URL(String(location), current).href);
        continue;
      }
      if (r.statusCode !== 200) {
        r.body.destroy();
        throw new ResearchError("web_http_" + r.statusCode, 502);
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of r.body) {
        const b = Buffer.from(chunk);
        length += b.length;
        if (length > 2_000_000) {
          r.body.destroy();
          throw new ResearchError("web_body_too_large", 422);
        }
        chunks.push(b);
      }
      return {
        url: current.href,
        text: Buffer.concat(chunks).toString("utf8"),
        contentType: String(r.headers["content-type"] || ""),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new ResearchError("redirect_limit");
}
export async function readPublicPage(url: string, signal: AbortSignal) {
  const page = await fetchPublic(url, signal);
  if (!page.contentType.includes("text/html"))
    throw new ResearchError("unsupported_page_type", 422);
  const { document } = parseHTML(page.text) as unknown as {
    document: {
      querySelectorAll: (s: string) => Array<{ remove: () => void }>;
    };
  };
  for (const el of document.querySelectorAll("script,style,form,iframe"))
    el.remove();
  const article = new Readability(document as never).parse();
  if (!article?.textContent?.trim())
    throw new ResearchError("page_body_missing", 422);
  return {
    url: page.url,
    title: article.title || "网页材料",
    body: article.textContent.trim(),
    author: article.byline || undefined,
  };
}
