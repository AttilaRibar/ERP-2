import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentToolContext } from "@/lib/agent/types";
import { requirePermission } from "@/lib/auth/permissions";

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchPayload {
  provider: string;
  results: WebSearchResult[];
  warning?: string;
}

const WebSearchSchema = z.object({
  query: z.string().min(2).max(300).describe("Public web search query."),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuckDuckGoUrl(href: string): string | null {
  try {
    const url = new URL(decodeHtml(href), "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ?? url.href;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function braveSearch(query: string): Promise<WebSearchPayload | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const json = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  const web = isRecord(json) && isRecord(json.web) ? json.web : null;
  const rawResults = web && Array.isArray(web.results) ? web.results : [];
  const results = rawResults.flatMap((item): WebSearchResult[] => {
    if (!isRecord(item)) return [];
    const title = asString(item.title);
    const urlValue = asString(item.url);
    const snippet = asString(item.description) ?? "";
    return title && urlValue ? [{ title, url: urlValue, snippet }] : [];
  });

  return { provider: "brave", results };
}

async function tavilySearch(query: string): Promise<WebSearchPayload | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const json = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: "basic" }),
  });

  const rawResults = isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const results = rawResults.flatMap((item): WebSearchResult[] => {
    if (!isRecord(item)) return [];
    const title = asString(item.title);
    const urlValue = asString(item.url);
    const snippet = asString(item.content) ?? "";
    return title && urlValue ? [{ title, url: urlValue, snippet }] : [];
  });

  return { provider: "tavily", results };
}

function collectDuckDuckGoTopics(topics: unknown[], results: WebSearchResult[]): void {
  for (const topic of topics) {
    if (!isRecord(topic)) continue;
    if (Array.isArray(topic.Topics)) {
      collectDuckDuckGoTopics(topic.Topics, results);
      continue;
    }
    const title = asString(topic.Text);
    const urlValue = asString(topic.FirstURL);
    if (title && urlValue) {
      results.push({ title, url: urlValue, snippet: title });
    }
    if (results.length >= 5) return;
  }
}

async function duckDuckGoSearch(query: string): Promise<WebSearchPayload> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const json = await fetchJson(url);
  const results: WebSearchResult[] = [];

  if (isRecord(json)) {
    const heading = asString(json.Heading);
    const abstractUrl = asString(json.AbstractURL);
    const abstractText = asString(json.AbstractText);
    if (heading && abstractUrl && abstractText) {
      results.push({ title: heading, url: abstractUrl, snippet: abstractText });
    }
    if (Array.isArray(json.RelatedTopics)) {
      collectDuckDuckGoTopics(json.RelatedTopics, results);
    }
  }

  return {
    provider: "duckduckgo_instant_answer",
    results: results.slice(0, 5),
    warning: results.length === 0 ? "Nem érkezett használható webes találat." : undefined,
  };
}

async function duckDuckGoHtmlSearch(query: string): Promise<WebSearchPayload> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 SmartERP/1.0",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const blocks = html.split(/<div class="result results_links[^>]*>/).slice(1);
    const results: WebSearchResult[] = [];

    for (const block of blocks) {
      const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;

      const targetUrl = normalizeDuckDuckGoUrl(link[1] ?? "");
      const title = stripHtml(link[2] ?? "");
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>[\s\S]*?<\/a>/);
      const snippet = snippetMatch ? stripHtml(snippetMatch[0]) : "";

      if (targetUrl && title) {
        results.push({ title, url: targetUrl, snippet });
      }
      if (results.length >= 5) break;
    }

    return {
      provider: "duckduckgo_html",
      results,
      warning: results.length === 0 ? "Nem érkezett használható webes találat." : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWeb(query: string): Promise<WebSearchPayload> {
  const brave = await braveSearch(query);
  if (brave) return brave;

  const tavily = await tavilySearch(query);
  if (tavily) return tavily;

  const duckDuckGoHtml = await duckDuckGoHtmlSearch(query);
  if (duckDuckGoHtml.results.length > 0) return duckDuckGoHtml;

  return duckDuckGoSearch(query);
}

export function createWebSearchTools(context: AgentToolContext) {
  if (!context.userId || !context.sessionId) {
    throw new Error("Missing agent tool runtime context");
  }

  return [
    tool(
      async ({ query }) => {
        await requirePermission("internet-search:use");
        return JSON.stringify(await searchWeb(query));
      },
      {
        name: "web_search",
        description:
          "Search the public internet for current information. Use only when the user enabled internet search for this session. Summarize results and include source URLs in the Hungarian answer.",
        schema: WebSearchSchema,
      },
    ),
  ];
}
