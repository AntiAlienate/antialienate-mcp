/**
 * AntiAlienate MCP Server — open-source knowledge network for parental alienation.
 * Streamable-HTTP MCP (JSON-RPC 2.0). Attach from Claude:
 *   claude mcp add antialienate --transport http https://mcp.antialienate.com
 * Knowledge source: knowledge.antialienate.com (CC-BY-4.0).
 * Principle: expose patterns, never people.
 */
import PLAYBOOK_RAW from "./playbook.json";
const PLAYBOOK = typeof PLAYBOOK_RAW === "string" ? JSON.parse(PLAYBOOK_RAW) : PLAYBOOK_RAW;

const KB = "https://knowledge.antialienate.com";
const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "search_knowledge",
    description:
      "Search the open-source AntiAlienate knowledge base: 299 case-law summaries, 359 jurisdiction guides, 35 case studies, 29 vetted practitioners, 28 evidence/documentation guides (CC-BY-4.0). Returns matching entries with ids for get_entry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to search for" },
        type: {
          type: "string",
          enum: ["case_law", "case_studies", "practitioners_therapists", "practitioners_lawyers", "evidence", "jurisdictions", "all"],
          description: "Restrict to one collection (default all)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_entry",
    description: "Fetch a full knowledge-base entry (JSON) by the path returned from search_knowledge.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Entry path from search results" } },
      required: ["path"],
    },
  },
  {
    name: "get_playbook",
    description:
      "The Alienation Playbook: the 5 recurring tactic patterns (access interference, gatekeeping, therapeutic manipulation, narrative control, child instrumentalization) with recognition signs and documentation counters, plus first-72-hours guidance. Expose patterns, never people.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "about_network",
    description:
      "About the AntiAlienate open-source network: what it is, the numbers, how to contribute, and next steps for a parent who needs help.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function fetchJSON(url) {
  const r = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

async function searchKnowledge(query, type) {
  const manifest = await fetchJSON(`${KB}/manifest.json`);
  const indexes = manifest.indexes || {};
  const wanted =
    !type || type === "all" ? Object.keys(indexes) : Object.keys(indexes).filter((k) => k === type);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  // top-level manifest arrays (evidence guides, jurisdictions) are searchable too
  if (!type || type === "all" || type === "evidence" || type === "jurisdictions") {
    for (const key of ["evidence", "jurisdictions"]) {
      if (type && type !== "all" && type !== key) continue;
      const arr = Array.isArray(manifest[key]) ? manifest[key] : [];
      for (const e of arr) {
        const hay = JSON.stringify(e).toLowerCase();
        const score = terms.reduce((s2, t) => s2 + (hay.includes(t) ? 1 : 0), 0);
        if (score > 0) results.push({ collection: key, score, entry: e });
      }
    }
  }
  for (const key of wanted) {
    let idx;
    const idxUrl = String(indexes[key]).startsWith("http") ? indexes[key] : `${KB}/${indexes[key]}`;
    try {
      idx = await fetchJSON(idxUrl);
    } catch {
      continue;
    }
    let entries = [];
    if (Array.isArray(idx)) entries = idx;
    else {
      for (const v of Object.values(idx)) {
        if (Array.isArray(v)) entries.push(...v);
        else if (v && typeof v === "object") {
          for (const vv of Object.values(v)) if (Array.isArray(vv)) entries.push(...vv);
        }
      }
    }
    for (const e of entries) {
      const hay = JSON.stringify(e).toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      if (score > 0)
        results.push({ collection: key, score, entry: e });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 12);
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: {
          name: "antialienate",
          version: "1.0.0",
          description:
            "Open-source parental-alienation knowledge network. 299 case-law summaries, 359 jurisdictions, 35 case studies. Expose patterns, never people.",
        },
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args = {} } = params || {};
      try {
        let payload;
        if (name === "search_knowledge") {
          payload = await searchKnowledge(args.query || "", args.type);
        } else if (name === "get_entry") {
          const p0 = String(args.path || "");
          const url = p0.startsWith("https://knowledge.antialienate.com/") ? p0
            : /^[\w\-\/\.]+\.json$/.test(p0) ? `${KB}/${p0}` : null;
          if (!url) throw new Error("invalid path");
          payload = await fetchJSON(url);
        } else if (name === "get_playbook") {
          payload = PLAYBOOK;
        } else if (name === "about_network") {
          payload = {
            network: "AntiAlienate Open Knowledge Network",
            what: "The largest open-source knowledge base dedicated to parental alienation: 299 case-law summaries, 359 jurisdiction guides, 35 anonymized case studies, 29 vetted practitioners, 28 evidence & documentation guides. License CC-BY-4.0.",
            principle: "Expose patterns, never people. Private records stay private until court.",
            attach: "claude mcp add antialienate --transport http https://mcp.antialienate.com",
            next_steps: {
              assessment: "https://antialienate.com/assessment (free, 2 minutes)",
              knowledge: "https://knowledge.antialienate.com",
              platform: "https://antialienate.com — Liena AI companion, evidence vault, court-ready reports",
            },
            contribute: "Anonymized pattern reports and KB corrections via the open repository — human-moderated.",
          };
        } else {
          return rpcError(id, -32602, `unknown tool: ${name}`);
        }
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        });
      } catch (e) {
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        });
      }
    }
    default:
      if (String(method || "").startsWith("notifications/")) return null; // ack-only
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method === "GET")
      return new Response(
        "AntiAlienate MCP server. Attach: claude mcp add antialienate --transport http https://mcp.antialienate.com",
        { headers: { ...cors, "content-type": "text/plain" } }
      );
    if (request.method !== "POST")
      return new Response("method not allowed", { status: 405, headers: cors });
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify(rpcError(null, -32700, "parse error")), {
        status: 400,
        headers: { ...cors, "content-type": "application/json" },
      });
    }
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];
    for (const m of messages) {
      const r = await handleRpc(m);
      if (r !== null && m.id !== undefined) responses.push(r);
    }
    if (!responses.length) return new Response(null, { status: 202, headers: cors });
    const out = Array.isArray(body) ? responses : responses[0];
    return new Response(JSON.stringify(out), {
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};
