import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.DEGOOG_TIMEOUT_MS ?? "15000",
  10,
);

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 degoog-mcp";

export async function fetchText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("url must start with http:// or https://");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`fetch ${resp.status}: ${resp.statusText}`);
  }

  const html = await resp.text();

  // jsdom is noisy about CSS it can't parse; silence it.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  return article?.textContent?.trim() ?? "";
}
