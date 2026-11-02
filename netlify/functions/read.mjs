// Netlify Function: reads recipe text with Claude and returns structured JSON.
// The API key stays here on the server (environment variable ANTHROPIC_API_KEY) and never reaches the browser.

const PROMPT = `You extract recipe data for a New Zealand food-import compliance checker. Below are the PREVIOUS messages of a food producer and their NEWEST message. If the newest message contains a new recipe list (one or more products with ingredients), it REPLACES everything before: use only the newest message and set "new_list": true. If the newest message only adds or corrects details (e.g. cooking temperatures, a missing %), apply it to the previous recipes and set "new_list": false.

Reply with ONLY a JSON object of this shape:
{"new_list":boolean,"products":[{"name":string,"type":"meal|breakfast|dessert|snack|drink|bar|accessory","ingredients":[{"name":string,"percent":number|null,"animal":"pork|beef|lamb|goat|venison|chicken|turkey|duck|other_meat|dairy|egg|fish|seafood|honey|gelatine|none","form":"pieces|stock_extract_fat"}],"cooking":[{"target":string,"temp_c":number|null,"minutes":number|null}],"whole_seeds":[string],"eu_only_allergens":[string]}],"unclear":[string]}

Rules:
- percent: the share of the product exactly as written; null if not given. NEVER invent numbers or temperatures.
- animal: milk, cream, butter, cheese, yoghurt, whey, milk powder, ghee = dairy. Mayonnaise = egg. Bacon, ham, sausage = pork unless stated otherwise. Coconut/oat/soy milk, plant cream = none. Meat stock, broth, extract, lard, dripping = that animal with form "stock_extract_fat".
- type "dessert" = cakes, puddings, custards, crumbles, biscuits, confectionery. "accessory" = non-food items (heater, spoon, wipe).
- cooking: one entry per stated heat step; target = the ingredient it applies to ("pork", "chicken", "egg", "milk"...) or "whole" for the whole dish; convert °F to °C and hours/seconds to minutes.
- whole_seeds: whole seeds or spices in the recipe that could germinate (chia, whole coriander seeds, mustard seeds, caraway…).
- eu_only_allergens: celery or mustard if present.
- unclear: short, specific questions about missing information that matter for import rules (missing % of meat/dairy/egg, missing cooking temperature/time of meat or egg). Name the product in each question.`;

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const MAX_CHARS = 20000; // protects your budget: very long inputs are refused

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Optional access code: set ACCESS_CODE in Netlify to protect the page
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return new Response(JSON.stringify({ error: "access" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const previous = Array.isArray(body.previous) ? body.previous.map(String).slice(-10) : [];
  const newest = String(body.newest || "").trim();
  if (!newest) return new Response("Bad request", { status: 400 });
  if ((previous.join("") + newest).length > MAX_CHARS) return new Response("Too long", { status: 413 });

  const input = PROMPT
    + (previous.length ? "PREVIOUS MESSAGES:\n" + previous.map((t, i) => `--- Message ${i + 1} ---\n${t}`).join("\n\n") : "PREVIOUS MESSAGES: none")
    + "\n\nNEWEST MESSAGE:\n" + newest;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: input }] }),
  });
  if (!r.ok) {
    console.error("Claude API error", r.status, await r.text());
    return new Response(JSON.stringify({ error: "claude" }), { status: 502, headers: { "content-type": "application/json" } });
  }
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  try {
    const json = JSON.parse(text.slice(start, end + 1));
    return new Response(JSON.stringify(json), { headers: { "content-type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "parse" }), { status: 502, headers: { "content-type": "application/json" } });
  }
};

export const config = { path: "/api/read" };
