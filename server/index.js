// server/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";

// Import new Supabase helpers
import {
  upsertOrderFromSession,
  listOrders,
  getOrderBySession,
  saveDraftOrder
} from "./supabase.js";

const CLIENT_URL = process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "";
const app = express();

// Logger
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path}`);
  next();
});

// CORS
app.use(
  cors({
    origin: CLIENT_URL ? [CLIENT_URL] : true,
    credentials: true
  })
);

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

// --- Webhook ---
const WEBHOOK_PATH = "/api/stripe-webhook";
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

app.post(WEBHOOK_PATH, express.raw({ type: "application/json" }), async (req, res) => {
  console.log("[webhook] hit");
  try {
    let event;
    if (!endpointSecret) {
      event = JSON.parse(req.body.toString());
    } else {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    }

    console.log("[webhook] type,", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      try {
        // Await the Supabase upsert
        await upsertOrderFromSession(session);
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

app.use(express.json({ limit: "2mb" }));

// Health
app.get("/", (_req, res) => res.json({ ok: true, service: "api-supabase" }));

// --- API Endpoints ---

// 1. Checkout: Create Session + Save Draft in Supabase
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
      line_items = [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: unit,
          product_data: { name: "Custom lampshade" }
        }
      }];
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

    // Save draft to Supabase immediately
    await saveDraftOrder(session.id, {
      packKey,
      modelKey,
      params, // Object is fine, helper handles it
      filename: filename || "lampshade.stl"
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    res.status(500).json({ error: "stripe_checkout_error", message: err?.message });
  }
});

// 2. Session Lookup (for client confirmation)
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

// 3. Log/Finalize Order (Replaces the GAS log)
app.post("/api/log/:sessionId", async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    // Retrieve latest status from Stripe
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = s?.payment_status === "paid" && s?.status === "complete";
    
    if (!paid) return res.status(402).json({ ok: false, error: "payment_not_completed" });

    // Upsert the final order details into Supabase
    const success = await upsertOrderFromSession(s);

    if (!success) {
      return res.status(500).json({ ok: false, error: "supabase_upsert_failed" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("log error:", e);
    return res.status(500).json({ ok: false, error: "log_failed", message: e?.message });
  }
});

// Admin endpoints
app.get("/api/orders", async (_req, res) => {
  const orders = await listOrders(200);
  res.json({ ok: true, orders });
});

app.get("/api/orders/:sessionId", async (req, res) => {
  const row = await getOrderBySession(req.params.sessionId);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, order: row });
});

// Listen
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`server on ${port}`));
