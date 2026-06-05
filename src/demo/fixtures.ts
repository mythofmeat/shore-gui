// Demo fixture data — hand-built fake conversations that exercise the UI's
// rendering surfaces without ever touching a real conversation or daemon.
//
// Each message object matches the shape coerceHistoryMessage() expects:
// msg_id / role / content / timestamp, plus optional images, content_blocks
// (thinking / tool_use / tool_result), metadata (token + timing) and
// finish_reason. See src/lib/messages.ts for the consuming code.

type Role = "user" | "assistant" | "system";

interface ImageRefLike {
  path: string;
  caption?: string | null;
  data?: string | null;
}

interface Block {
  type: string;
  [key: string]: unknown;
}

export interface DemoMessage {
  msg_id: string;
  role: Role;
  content: string;
  timestamp: string;
  images?: ImageRefLike[];
  content_blocks?: Block[];
  metadata?: unknown;
  finish_reason?: string;
}

export interface DemoCharacter {
  name: string;
  avatar?: { mime_type: string; data: string };
}

export interface ConnectionPayload {
  kind: "connected";
  server_name: string;
  characters: DemoCharacter[];
  selected_character: string | null;
  history: DemoMessage[];
  active_start: number;
  config: Record<string, unknown>;
}

export interface DemoFrame {
  /** Milliseconds after the previous frame (or after connect for the first). */
  delay: number;
  frame: Record<string, unknown>;
}

export interface Scenario {
  label: string;
  connection: ConnectionPayload;
  /** Optional scripted `server-message` frames emitted after connect. */
  frames?: DemoFrame[];
}

// --- low-level builders ----------------------------------------------------

// A fixed clock so time-gap labels are deterministic across runs. Minutes are
// added from this base; large jumps drive the "a day passes" dividers.
const BASE = Date.parse("2026-03-02T09:00:00.000Z");
let seq = 0;

function nextId(): string {
  return `demo-${String(seq++).padStart(3, "0")}`;
}

/** Timestamp `minutes` after the fixed base clock. */
function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

function msg(role: Role, content: string, extra: Partial<DemoMessage> = {}): DemoMessage {
  return {
    msg_id: nextId(),
    role,
    content,
    timestamp: extra.timestamp ?? at(seq),
    ...extra,
  };
}

function tokens(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return { input, output, cache_read: cacheRead, cache_write: cacheWrite };
}

function meta(
  input: number,
  output: number,
  model: string,
  totalMs: number,
  ttftMs: number,
  cacheRead = 0,
  cacheWrite = 0,
) {
  return {
    tokens: tokens(input, output, cacheRead, cacheWrite),
    timing: { total_ms: totalMs, ttft_ms: ttftMs },
    model,
  };
}

// --- inline SVG images (no binary assets needed) ---------------------------

function svgDataUri(svg: string): string {
  // ImageGallery accepts full data: URIs verbatim; base64 avoids escaping woes.
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function swatch(w: number, h: number, from: string, to: string, label: string): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
      `<text x="50%" y="50%" fill="#fff8ee" font-family="serif" font-size="${Math.round(h / 8)}" ` +
      `text-anchor="middle" dominant-baseline="middle" opacity="0.85">${label}</text></svg>`,
  );
}

function avatar(letter: string, bg: string): { mime_type: string; data: string } {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="34" fill="#fff8ee" font-family="serif" font-size="34" ` +
    `text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
  return { mime_type: "image/svg+xml", data: btoa(svg) };
}

// --- reusable message groups ----------------------------------------------

function markdownGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("user", "Can you give me a quick tour of your markdown rendering? Headings, lists, quotes, the works."),
    msg(
      "assistant",
      [
        "# Markdown, in brief",
        "",
        "A few **bold** strokes, some *italic* asides, and a little `inline code` to taste.",
        "",
        "## Lists",
        "",
        "- first thing",
        "- second thing",
        "  - a nested clause",
        "  - and another",
        "- third thing",
        "",
        "1. ordered",
        "2. and orderly",
        "3. to a fault",
        "",
        "## A task list",
        "",
        "- [x] ship the demo harness",
        "- [ ] catch the visual bugs",
        "- [ ] sleep",
        "",
        "## A quote",
        "",
        "> The sea, once it casts its spell, holds one in its net of wonder forever.",
        "> — *Jacques Cousteau*",
        "",
        "## A table",
        "",
        "| surface | status | note |",
        "| --- | --- | --- |",
        "| markdown | ok | rendered via remark-gfm |",
        "| code | ok | prism highlighting |",
        "| images | ok | inline data URIs |",
        "",
        "Some prose with a [link to the shore](https://example.com/shore) tucked inside it, then a rule:",
        "",
        "---",
        "",
        "…and we land softly on the far side.",
      ].join("\n"),
      { metadata: meta(1840, 320, "claude-opus-4-8", 4200, 380, 12000, 1840) },
    ),
  ];
}

function codeGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("user", "Show me code blocks in a few languages — and one with a really long line so I can see horizontal scroll."),
    msg(
      "assistant",
      [
        "Here's a spread across languages.",
        "",
        "```typescript",
        "export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {",
        "  let t: ReturnType<typeof setTimeout> | undefined;",
        "  return (...args: A) => {",
        "    clearTimeout(t);",
        "    t = setTimeout(() => fn(...args), ms);",
        "  };",
        "}",
        "```",
        "",
        "```python",
        "def fib(n: int) -> int:",
        "    a, b = 0, 1",
        "    for _ in range(n):",
        "        a, b = b, a + b",
        "    return a",
        "```",
        "",
        "```rust",
        "fn main() {",
        '    let greeting = "hello, shore";',
        "    println!(\"{greeting}\");",
        "}",
        "```",
        "",
        "```bash",
        "# a long line to force horizontal scroll inside the code block",
        'curl -sS "https://api.example.com/v1/very/long/endpoint?with=several&query=params&that=keep&going=on&and=on&past=the&edge=true" | jq ".data[] | {id, name, score}"',
        "```",
        "",
        "And a little inline `const x = 42;` for good measure.",
      ].join("\n"),
      { metadata: meta(900, 540, "claude-opus-4-8", 5100, 410) },
    ),
  ];
}

function thinkingGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("user", "What's 17 × 24, and how did you get there?"),
    msg(
      "assistant",
      "It's **408**.\n\nI split it as 17 × 24 = 17 × (25 − 1) = 425 − 17 = 408.",
      {
        content_blocks: [
          {
            type: "thinking",
            thinking:
              "Let me compute 17 × 24. I can do 17 × 25 = 425, then subtract 17 to get 408. " +
              "Double-check: 17 × 24 = 17 × 20 + 17 × 4 = 340 + 68 = 408. Consistent. Good.",
          },
          { type: "text", text: "It's 408." },
        ],
        metadata: meta(120, 90, "claude-opus-4-8", 2600, 1200),
      },
    ),
  ];
}

function toolGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("user", "Look up the weather and check the build status."),
    msg(
      "assistant",
      "Both done — it's clear and **62°F**, and the latest build passed. I also tried the flaky integration check, which failed as usual.",
      {
        content_blocks: [
          {
            type: "tool_use",
            id: "tool-weather",
            name: "get_weather",
            input: { location: "Point Reyes, CA", units: "fahrenheit" },
          },
          {
            type: "tool_result",
            tool_use_id: "tool-weather",
            content: JSON.stringify(
              { tempF: 62, condition: "clear", windMph: 8, humidity: 0.71 },
              null,
              2,
            ),
          },
          {
            type: "tool_use",
            id: "tool-http",
            name: "http_request",
            input: {
              url: "https://ci.example.com/api/builds/latest",
              method: "GET",
              headers: { Authorization: "Bearer <redacted>", Accept: "application/json" },
            },
          },
          {
            type: "tool_result",
            tool_use_id: "tool-http",
            content: JSON.stringify({ build: 4821, status: "passed", durationSec: 412 }, null, 2),
          },
          {
            type: "tool_use",
            id: "tool-flaky",
            name: "run_integration_suite",
            input: { suite: "integration", retries: 0 },
          },
          {
            type: "tool_result",
            tool_use_id: "tool-flaky",
            content: "Error: timeout after 30s waiting for fixture `db.seed` (exit 124)",
            is_error: true,
          },
          {
            type: "tool_use",
            id: "tool-pending",
            name: "deploy_preview",
            input: { branch: "visual-bugs", wait: true },
          },
        ],
        metadata: meta(2100, 280, "claude-opus-4-8", 8800, 620, 4000, 2100),
      },
    ),
  ];
}

function imageGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("user", "Here are a couple of reference shots — what do you think of the palette?", {
      images: [
        { path: "dusk.svg", caption: "dusk over the water", data: swatch(360, 240, "#c2410c", "#7c2d12", "dusk") },
        { path: "fog.svg", caption: "morning fog", data: swatch(360, 240, "#475569", "#1e293b", "fog") },
      ],
    }),
    msg(
      "assistant",
      "The warm dusk gradient is lovely — it echoes the ember accent. Here's a swatch I'd pair with it:",
      {
        images: [
          { path: "ember.svg", caption: "proposed accent", data: swatch(480, 200, "#f59e0b", "#b45309", "ember") },
        ],
        metadata: meta(640, 150, "claude-opus-4-8", 3000, 300),
      },
    ),
  ];
}

function tokenGroup(): DemoMessage[] {
  seq = 0;
  // Several settled assistant turns carrying metadata so the StatusBar,
  // per-message metadata, and the TokenDashboard all have numbers to show.
  return [
    msg("user", "Let's run a few turns so the token dashboard has something to chew on."),
    msg("assistant", "Turn one, reporting in.", {
      metadata: meta(3200, 410, "claude-opus-4-8", 4100, 360, 28000, 3200),
    }),
    msg("user", "Another."),
    msg("assistant", "Turn two — cache is warming up nicely.", {
      metadata: meta(900, 520, "claude-opus-4-8", 5200, 290, 31000, 0),
    }),
    msg("user", "And one more, a longer one."),
    msg("assistant", "Turn three, with a heftier output to skew the out/in ratio.", {
      metadata: meta(1100, 1850, "claude-sonnet-4-6", 9800, 410, 33000, 0),
      finish_reason: "stop",
    }),
  ];
}

function gapGroup(): DemoMessage[] {
  seq = 0;
  // Explicit, widely-spaced timestamps drive the literary time-gap dividers
  // ("an hour passes", "two days pass", "a month passes").
  return [
    msg("user", "Morning.", { timestamp: at(0) }),
    msg("assistant", "Morning. Tide's out.", { timestamp: at(1), metadata: meta(40, 12, "claude-opus-4-8", 900, 200) }),
    msg("user", "Back. That took a while.", { timestamp: at(180) }), // +3h
    msg("assistant", "Three hours — you missed the heron.", { timestamp: at(181), metadata: meta(60, 20, "claude-opus-4-8", 1100, 220) }),
    msg("user", "New day, new question.", { timestamp: at(180 + 60 * 24 * 2) }), // +2 days
    msg("assistant", "Two days gone. Ask away.", { timestamp: at(181 + 60 * 24 * 2), metadata: meta(80, 30, "claude-opus-4-8", 1200, 210) }),
    msg("user", "It's been ages.", { timestamp: at(180 + 60 * 24 * 40) }), // +~40 days
    msg("assistant", "A month and more. The shore remembers.", { timestamp: at(181 + 60 * 24 * 40), metadata: meta(90, 40, "claude-opus-4-8", 1300, 230) }),
  ];
}

function edgeGroup(): DemoMessage[] {
  seq = 0;
  return [
    msg("system", "System note: the following turns exercise layout edge cases."),
    msg(
      "user",
      "Here's an unbreakable token: supercalifragilisticexpialidocious_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_and_a_url https://example.com/an/extremely/long/path/that/should/not/break/the/layout/0123456789/abcdefghijklmnopqrstuvwxyz",
    ),
    msg(
      "assistant",
      [
        "Emoji and scripts: 🌊🔥🏝️ — 你好，世界 — مرحبا بالعالم — Здравствуй, мир.",
        "",
        "A deeply nested JSON tool result is below; the tree should stay readable.",
      ].join("\n"),
      {
        content_blocks: [
          {
            type: "tool_use",
            id: "tool-nested",
            name: "inspect_config",
            input: {
              level1: {
                level2: {
                  level3: { array: [1, 2, 3, { deep: true, n: 9_007_199_254_740_991 }], flag: false },
                },
                siblings: ["a", "b", "c"],
              },
              empty: {},
              nil: null,
            },
          },
          {
            type: "tool_result",
            tool_use_id: "tool-nested",
            content: JSON.stringify({ ok: true, keys: 42 }),
          },
        ],
        metadata: meta(500, 200, "claude-opus-4-8", 2000, 300),
      },
    ),
    msg("assistant", "", { metadata: meta(10, 0, "claude-opus-4-8", 400, 400), finish_reason: "stop" }),
  ];
}

function longConversation(): DemoMessage[] {
  seq = 0;
  const out: DemoMessage[] = [];
  const topics = [
    "tides", "fog", "herons", "driftwood", "lighthouses", "kelp", "gulls",
    "the ferry", "low pressure", "the jetty", "salt", "the long pier",
  ];
  for (let i = 0; i < 24; i++) {
    const topic = topics[i % topics.length];
    out.push(msg("user", `Tell me something about ${topic}.`, { timestamp: at(i * 7) }));
    out.push(
      msg(
        "assistant",
        `On the subject of ${topic}: a short, plausible paragraph that exists mainly to give the ` +
          `scrollback some height so the timeline scrubber and long-scroll behaviour have something ` +
          `to grip. This is reply number ${i + 1}.`,
        { timestamp: at(i * 7 + 3), metadata: meta(300 + i * 10, 120 + i * 4, "claude-opus-4-8", 1500, 250) },
      ),
    );
  }
  return out;
}

// --- characters ------------------------------------------------------------

const CHARACTERS: DemoCharacter[] = [
  { name: "Shore", avatar: avatar("S", "#b45309") },
  { name: "Beacon", avatar: avatar("B", "#0f766e") },
  { name: "Wren", avatar: avatar("W", "#7c3aed") },
];

function connection(history: DemoMessage[], selected = "Shore"): ConnectionPayload {
  return {
    kind: "connected",
    server_name: "demo.shore.local",
    characters: CHARACTERS,
    selected_character: selected,
    history,
    active_start: 0,
    config: {},
  };
}

// --- scenarios -------------------------------------------------------------

function allHistory(): DemoMessage[] {
  // Compose the focused groups into one long, mixed conversation. Each group
  // resets `seq`, so re-key the ids to keep them globally unique and ordered.
  const groups = [
    markdownGroup(),
    codeGroup(),
    thinkingGroup(),
    toolGroup(),
    imageGroup(),
    tokenGroup(),
    edgeGroup(),
  ];
  let n = 0;
  let clock = 0;
  const merged: DemoMessage[] = [];
  for (const group of groups) {
    for (const m of group) {
      merged.push({ ...m, msg_id: `all-${String(n++).padStart(3, "0")}`, timestamp: at(clock++) });
    }
  }
  return merged;
}

// A scripted live stream: thinking, then prose, then a tool call/result, then
// more prose. It deliberately never sends `stream_end`, so the streaming UI
// (pulsing sigil, phase/model status, typing cursor) stays put for a screenshot.
function streamingFrames(rid: string): DemoFrame[] {
  const chunk = (text: string, content_type = "text") => ({ type: "stream_chunk", rid, text, content_type });
  return [
    { delay: 400, frame: { type: "stream_start", rid } },
    { delay: 200, frame: { type: "phase", rid, phase: "thinking", model: "claude-opus-4-8" } },
    { delay: 250, frame: chunk("Let me reason about this for a moment. ", "thinking") },
    { delay: 350, frame: chunk("The user wants a live streaming view, so I should keep talking.", "thinking") },
    { delay: 400, frame: { type: "phase", rid, phase: "responding", model: "claude-opus-4-8" } },
    { delay: 250, frame: chunk("Here's a reply, ") },
    { delay: 250, frame: chunk("arriving ") },
    { delay: 250, frame: chunk("a few words ") },
    { delay: 250, frame: chunk("at a time. ") },
    { delay: 500, frame: { type: "phase", rid, phase: "tool_use", model: "claude-opus-4-8" } },
    {
      delay: 200,
      frame: { type: "tool_call", rid, tool_id: "live-tool", tool_name: "search_notes", input: { q: "shoreline" } },
    },
    {
      delay: 800,
      frame: { type: "tool_result", rid, tool_id: "live-tool", tool_name: "search_notes", output: "3 matches found" },
    },
    { delay: 300, frame: { type: "phase", rid, phase: "responding", model: "claude-opus-4-8" } },
    { delay: 250, frame: chunk("Found a few notes — ") },
    { delay: 300, frame: chunk("and I'll keep going, ") },
    { delay: 300, frame: chunk("streaming indefinitely so you can capture this state…") },
  ];
}

function noticeFrames(): DemoFrame[] {
  return [
    { delay: 500, frame: { type: "cache_warning", message: "Prompt cache miss — full context re-sent (this turn cost more)." } },
    { delay: 900, frame: { type: "provider_fallback_warning", provider: "anthropic", from_key: "primary", to_key: "fallback" } },
    { delay: 900, frame: { type: "usage_warning", message: "Approaching the monthly usage budget (82% used)." } },
    { delay: 900, frame: { type: "error", code: "rate_limited", message: "Rate limited by upstream provider — retrying in 5s." } },
  ];
}

export function buildScenario(name: string): Scenario {
  switch (name) {
    case "markdown":
      return { label: "Markdown", connection: connection(markdownGroup()) };
    case "code":
      return { label: "Code blocks", connection: connection(codeGroup()) };
    case "thinking":
      return { label: "Thinking blocks", connection: connection(thinkingGroup()) };
    case "tools":
      return { label: "Tool calls & inspector", connection: connection(toolGroup()) };
    case "images":
      return { label: "Images", connection: connection(imageGroup()) };
    case "tokens":
      return { label: "Token / cost", connection: connection(tokenGroup()) };
    case "gaps":
      return { label: "Time gaps", connection: connection(gapGroup()) };
    case "long":
    case "long-scroll":
      return { label: "Long scroll", connection: connection(longConversation()) };
    case "edge":
    case "edge-cases":
      return { label: "Edge cases", connection: connection(edgeGroup()) };
    case "multi":
    case "multi-character":
      return { label: "Multi-character", connection: connection(toolGroup(), "Beacon") };
    case "notices":
      return { label: "Notices & errors", connection: connection(markdownGroup()), frames: noticeFrames() };
    case "streaming":
      return { label: "Live streaming", connection: connection(thinkingGroup()), frames: streamingFrames("live-rid-1") };
    case "empty":
      return { label: "Empty / fresh", connection: connection([]) };
    case "all":
    default:
      return { label: "Everything", connection: connection(allHistory()) };
  }
}

export const SCENARIO_NAMES = [
  "all", "markdown", "code", "thinking", "tools", "images", "tokens",
  "gaps", "long-scroll", "edge-cases", "multi-character", "notices",
  "streaming", "empty",
];
