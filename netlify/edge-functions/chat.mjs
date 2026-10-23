// =====================================================================
//  YE FILE SERVER PAR CHALTI HAI (Netlify Function). Browser ko ye
//  dikhti nahi.
//
//  API KEY KAHAN DAALNI HAI?
//  Is file mein KEY KABHI MAT LIKHNA.
//  Key yahan daalo:
//     Netlify -> apni Site -> Site configuration -> Environment variables
//        -> Add a variable
//        Key   : GROQ_API_KEY
//        Value : gsk_....  (apni nayi Groq key)
//     Save karo, phir Deploys -> Trigger deploy -> Deploy site.
//
//  Free key kahan se milegi: console.groq.com/keys
// =====================================================================

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }
  });

// ---------------------------------------------------------------------
// Very small in-memory rate limiter. Netlify Functions run in short-lived
// instances, so this is best-effort (resets when a fresh instance spins
// up) — it stops a single abusive client from hammering the endpoint
// within one instance's lifetime, it's not a substitute for a real
// rate-limiting service, but it's enough for a personal/small-scale app.
// ---------------------------------------------------------------------
const hits = new Map();
const RATE_LIMIT = 20;       // requests
const RATE_WINDOW_MS = 60_000; // per 60s, per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (hits.size > 5000) hits.clear(); // guard against unbounded memory growth
  return entry.count > RATE_LIMIT;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: { message: "POST only" } }, 405);
  }

  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
  if (isRateLimited(ip)) {
    return json({ error: { message: "Too many requests. Please slow down and try again shortly." } }, 429);
  }

  // Login check: agar FIREBASE_API_KEY set hai to sirf sign in users ko jawab milega
  const FB = process.env.FIREBASE_API_KEY;
  if (FB) {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tok) return json({ error: { message: "Please sign in first." } }, 401);
    try {
      const v = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FB, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: tok })
      });
      if (!v.ok) return json({ error: { message: "Session expired. Please sign in again." } }, 401);
    } catch (e) {
      return json({ error: { message: "Login check failed." } }, 500);
    }
  }

  // Agar Netlify mein key nahi daali to saaf message milega
  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) {
    return json({
      error: { message: "GROQ_API_KEY is not set on the server. Add it in Netlify environment variables and redeploy." }
    }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: { message: "Bad request" } }, 400);
  }

  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) {
    return json({ error: { message: "Bad request" } }, 400);
  }

  const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);
  const MAX_TEXT_LEN = 16000; // per text part
  const MAX_IMAGES = 4;       // per request
  let imageCount = 0;

  for (const m of messages) {
    if (!m || typeof m !== "object" || !ALLOWED_ROLES.has(m.role)) {
      return json({ error: { message: "Bad request" } }, 400);
    }
    if (typeof m.content === "string") {
      if (m.content.length > MAX_TEXT_LEN) {
        return json({ error: { message: "Message is too long." } }, 400);
      }
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part || typeof part !== "object") {
          return json({ error: { message: "Bad request" } }, 400);
        }
        if (part.type === "text") {
          if (typeof part.text !== "string" || part.text.length > MAX_TEXT_LEN) {
            return json({ error: { message: "Message is too long." } }, 400);
          }
        } else if (part.type === "image_url") {
          imageCount++;
          if (imageCount > MAX_IMAGES) {
            return json({ error: { message: "Too many images in one message." } }, 400);
          }
          const url = part.image_url && part.image_url.url;
          if (typeof url !== "string" || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(url)) {
            return json({ error: { message: "Bad request" } }, 400);
          }
        } else {
          return json({ error: { message: "Bad request" } }, 400);
        }
      }
    } else {
      return json({ error: { message: "Bad request" } }, 400);
    }
  }

  const hasImg = imageCount > 0;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Key yahan environment variable se aati hai (code mein likhi nahi hoti)
        "Authorization": "Bearer " + KEY
      },
      body: JSON.stringify({
        model: hasImg ? (process.env.VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct") : "openai/gpt-oss-120b",
        messages,
        temperature: 0.8,
        ...(hasImg ? {} : { reasoning_effort: "low" }),
        max_tokens: 2500
      })
    });

    const data = await r.json();
    return json(data, r.status);
  } catch (e) {
    return json({ error: { message: "Server error" } }, 500);
  }
};

// Isse /api/chat ka address is function se jud jata hai (index.html mein kuch badalna nahi)
export const config = { path: "/api/chat" };
