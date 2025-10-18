// server/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import Stripe from "stripe";
import fetch from "node-fetch";

import {
  upsertOrderFromSession,
  listOrders,
  getOrderBySession,
  saveDraftOrder
} from "./db.js";

// Resolve front end origin once
const CLIENT_URL = process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "";

// App
const app = express();

// tiny request logger for Render logs
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path}`);
  next();
});

// CORS, allow your front end only
app.use(
  cors({
    origin: CLIENT_URL ? [CLIENT_URL] : true,
    credentials: true
  })
);

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

// Webhook path, keep explicit for Stripe dashboard
const WEBHOOK_PATH = "/api/stripe-webhook";

// Webhook first, raw body for signature verification
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
app.post(WEBHOOK_PATH, express.raw({ type: "application/json" }), (req, res) => {
  console.log("[webhook] hit");
  try {
    let event;

    if (!endpointSecret) {
      // useful for quick local testing without signing
      event = JSON.parse(req.body.toString());
    } else {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    }

    console.log("[webhook] type,", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      try {
        upsertOrderFromSession(session);
        console.log("[webhook] upsertOrderFromSession ok");
      } catch (e) {
        console.error("[webhook] upsert failed", e);
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("[webhook] error", e);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// JSON parser comes after the webhook
app.use(express.json({ limit: "2mb" }));

// Friendly health and debug
app.get("/", (_req, res) => res.json({ ok: true, service: "api", time: new Date().toISOString() }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/debug", (_req, res) =>
  res.json({
    webhookHasSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    webhookPath: WEBHOOK_PATH,
    clientUrl: CLIENT_URL || null,
    priceCents: process.env.PRICE_CENTS ? Number(process.env.PRICE_CENTS) : null,
    currency: process.env.CURRENCY || null,
    gasWebappConfigured: !!process.env.GAS_WEBAPP_URL
  })
);

// Quick Apps Script test, logs a tiny row
app.get("/api/gas-test", async (_req, res) => {
  try {
    if (!process.env.GAS_WEBAPP_URL) {
      return res.status(500).json({ error: "no_gas_webapp", hint: "Set GAS_WEBAPP_URL in env" });
    }
    const payload = {
      secret: process.env.GAS_SHARED_SECRET || "",
      orderNumber: "ORDER_000000",
      sessionId: "test_session",
      email: "test@example.com",
      name: "Test User",
      phone: "",
      addressSimple: "123 Test St, Testville",
      colorName: "Frost White",
      amount: 0,
      packKey: "shade",
      modelKey: "solid",
      paramsJson: JSON.stringify({ ping: true })
    };
    const r = await fetch(process.env.GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return res.status(r.status).json({ status: r.status, body });
  } catch (e) {
    return res.status(500).json({ error: "gas_test_failed", message: e?.message });
  }
});

// Helpers
function makeAddressSimple(ship) {
  if (!ship || !ship.address) return "";
  const a = ship.address;
  return [a.line1 || "", a.line2 || "", a.city || "", a.state || a.region || "", a.postal_code || "", a.country || ""]
    .filter(Boolean)
    .join(", ");
}
function extractColorNameFromParams(paramsJson) {
  try {
    const obj = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
    return obj?.colorName || "";
  } catch {
    return "";
  }
}

// Checkout, store design draft in DB, keep Stripe metadata tiny
app.post("/api/checkout", async (req, res) => {
  try {
    const { packKey, modelKey, params, filename } = req.body || {};
    if (!packKey || !modelKey || !params) return res.status(400).json({ error: "missing_input" });
    if (!CLIENT_URL) return res.status(500).json({ error: "client_url_missing" });

    let line_items;
    if (process.env.STRIPE_PRICE_ID) {
      line_items = [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }];
    } else {
      const unit = parseInt(process.env.PRICE_CENTS || "0", 10);
      const currency = (process.env.CURRENCY || "usd").toLowerCase();
      if (!unit || unit < 50) return res.status(500).json({ error: "price_not_configured" });
      line_items = [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unit,
            product_data: { name: "Custom lampshade" }
          }
        }
      ];
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_creation: "always",
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ["NZ", "AU", "US", "CA", "GB", "IE", "DE", "FR", "NL", "BE", "SE", "NO", "DK", "ES", "IT"]
      },
      success_url: `${CLIENT_URL}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/?canceled=1`,
      metadata: {
        packKey,
        modelKey,
        filename: filename || "lampshade.stl"
      }
    });

    // persist the full design locally keyed by session id
    saveDraftOrder(session.id, {
      packKey,
      modelKey,
      params_json: JSON.stringify(params),
      filename: filename || "lampshade.stl"
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    res.status(500).json({ error: "stripe_checkout_error", message: err?.message });
  }
});

// Verify a session
app.get("/api/session/:id", async (req, res) => {
  try {
    const s = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({
      ok: true,
      paid: s?.payment_status === "paid" && s?.status === "complete",
      metadata: s?.metadata || {}
    });
  } catch (e) {
    res.status(500).json({ error: "lookup_failed", message: e?.message });
  }
});

// Log variables only to Apps Script, no STL
app.post("/api/log/:sessionId", async (req, res) => {
  try {
    if (!process.env.GAS_WEBAPP_URL) {
      return res.status(500).json({ ok: false, error: "gas_webapp_missing" });
    }
    const sessionId = req.params.sessionId;
    const s = await stripe.checkout.sessions.retrieve(sessionId);

    const paid = s?.payment_status === "paid" && s?.status === "complete";
    if (!paid) return res.status(402).json({ ok: false, error: "payment_not_completed" });

    // ensure DB has the order
    try { upsertOrderFromSession(s); } catch (e) { console.error("upsertOrderFromSession failed:", e); }

    const row = getOrderBySession(sessionId) || {};
    const orderNumber = row?.id ? `ORDER_${String(row.id).padStart(6, "0")}` : "";
    const email = s?.customer_details?.email || row?.email || "";
    const name = s?.shipping_details?.name || row?.name || "";
    const phone = s?.customer_details?.phone || row?.phone || "";
    const simpleAddress = makeAddressSimple(s?.shipping_details || null);
    const colorName = extractColorNameFromParams(row?.params_json || "");
    const amount = s?.amount_total ?? row?.amount_total ?? "";

    const payload = {
      secret: process.env.GAS_SHARED_SECRET || "",
      orderNumber,
      sessionId,
      email,
      name,
      phone,
      addressSimple: simpleAddress,
      colorName,
      amount,
      packKey: row?.pack_key || s?.metadata?.packKey || "",
      modelKey: row?.model_key || s?.metadata?.modelKey || "",
      paramsJson: row?.params_json || ""
    };

    const r = await fetch(process.env.GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let js;
    try { js = JSON.parse(text); } catch { js = null; }

    if (!js || js.ok !== true) {
      return res.status(500).json({ ok: false, error: "gas_log_failed", detail: js || text });
    }

    return res.json({ ok: true, sheet: js });
  } catch (e) {
    console.error("log error:", e);
    return res.status(500).json({ ok: false, error: "log_failed", message: e?.message });
  }
});

// Admin endpoints
app.get("/api/orders", (_req, res) => res.json({ ok: true, orders: listOrders(200) }));
app.get("/api/orders/:sessionId", (req, res) => {
  const row = getOrderBySession(req.params.sessionId);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, order: row });
});

// listen
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`server on ${port}`));
