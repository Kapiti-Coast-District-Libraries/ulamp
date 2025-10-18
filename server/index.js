// server/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import Stripe from "stripe";
import { google } from "googleapis";
import fetch from "node-fetch";

import {
  upsertOrderFromSession,
  markUploaded,
  listOrders,
  getOrderBySession,
  saveDraftOrder
} from "./db.js";

// map GOOGLE_SERVICE_ACCOUNT_PATH to GOOGLE_APPLICATION_CREDENTIALS if provided
if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
}

const app = express();

// tiny request logger so you can see traffic in Render Runtime logs
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path}`);
  next();
});

// Resolve front end origin once
const CLIENT_URL = process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "";

// CORS, allow your front end only
app.use(
  cors({
    origin: CLIENT_URL ? [CLIENT_URL] : true,
    credentials: true
  })
);

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

// Make the webhook path explicit so it is easy to match in Stripe dashboard
const WEBHOOK_PATH = "/api/stripe-webhook";

// Webhook first, with raw body for signature verification
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
app.post(WEBHOOK_PATH, express.raw({ type: "application/json" }), (req, res) => {
  console.log("[webhook] hit");
  try {
    let event;

    if (!endpointSecret) {
      // useful for quick local tests without signing
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

// Google Drive service account
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const hasSaKey = !!saPath && fs.existsSync(saPath);

let drive = null;
if (hasSaKey) {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  });
  drive = google.drive({ version: "v3", auth });
} else {
  console.log("[drive] no service account key, will use GAS if configured");
}

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
    driveFolderIdPresent: !!process.env.DRIVE_FOLDER_ID,
    gasWebappConfigured: !!process.env.GAS_WEBAPP_URL
  })
);

// Quick Apps Script test
app.get("/api/gas-test", async (_req, res) => {
  try {
    if (!process.env.GAS_WEBAPP_URL) {
      return res.status(500).json({ error: "no_gas_webapp", hint: "Set GAS_WEBAPP_URL in env" });
    }
    const payload = {
      secret: process.env.GAS_SHARED_SECRET || "",
      folderId: process.env.DRIVE_FOLDER_ID,
      filename: "gas_test_" + Date.now() + ".txt",
      mimeType: "text/plain",
      base64: Buffer.from("hello from server " + new Date().toISOString()).toString("base64")
    };
    const r = await fetch(process.env.GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return res.status(r.status).json({ status: r.status, body });
  } catch (e) {
    return res.status(500).json({ error: "gas_test_failed", message: e?.message });
  }
});

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
            product_data: { name: "Custom lampshade STL" }
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

// Ensure uploads folder exists for multer
const uploadDir = "uploads";
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch {
  // ignore
}

// Upload STL to Drive, idempotent per session, names file with order id
const upload = multer({ dest: uploadDir + "/" });
const inFlightUploads = new Set();

function pad6(n) {
  try {
    return String(n ?? 0).toString().padStart(6, "0");
  } catch {
    return "000000";
  }
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { session_id } = req.body || {};
  const incomingName = req.body?.filename || "lampshade.stl";
  if (!session_id || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "missing_session_or_file" });
  }

  try {
    // Already uploaded
    const existing = getOrderBySession(session_id);
    if (existing && existing.uploaded === 1 && existing.drive_file_id) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      return res.json({
        ok: true,
        alreadyUploaded: true,
        file: {
          id: existing.drive_file_id,
          webViewLink: existing.drive_web_view_link,
          webContentLink: existing.drive_web_content_link
        }
      });
    }

    if (inFlightUploads.has(session_id)) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      return res.status(202).json({ ok: false, error: "upload_in_progress" });
    }
    inFlightUploads.add(session_id);

    // Verify session and upsert order basics
    const s = await stripe.checkout.sessions.retrieve(session_id);
    const paid = s?.payment_status === "paid" && s?.status === "complete";
    if (!paid) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      inFlightUploads.delete(session_id);
      return res.status(402).json({ error: "payment_not_completed" });
    }
    try {
      upsertOrderFromSession(s);
    } catch (e) {
      console.error("upsertOrderFromSession failed:", e);
    }

    // Lookup order row, get id and params for color and address
    const orderRow = getOrderBySession(session_id);
    const orderId = orderRow?.id;
    const colorName = extractColorNameFromParams(orderRow?.params_json || "");
    const simpleAddress = makeAddressSimple(s?.shipping_details || null);
    const email = s?.customer_details?.email || "";
    const name = s?.shipping_details?.name || "";
    const phone = s?.customer_details?.phone || "";
    const amount = s?.amount_total ?? "";

    // Name file with order number
    const baseExt = incomingName.toLowerCase().endsWith(".stl") ? ".stl" : ".stl";
    const finalName = `ORDER_${pad6(orderId)}_lampshade${baseExt}`;

    // Upload to Drive, either via SA or GAS
    const folderId = process.env.DRIVE_FOLDER_ID;
    let fileData = null;

    if (hasSaKey && drive) {
      const media = { mimeType: "application/sla", body: fs.createReadStream(req.file.path) };
      const meta = { name: finalName, parents: folderId ? [folderId] : undefined };
      const { data } = await drive.files.create({
        requestBody: meta,
        media,
        fields: "id,name,webViewLink,webContentLink"
      });
      fileData = data;
    } else if (process.env.GAS_WEBAPP_URL) {
      const buf = fs.readFileSync(req.file.path);
      const payload = {
        secret: process.env.GAS_SHARED_SECRET || "",
        folderId: folderId,
        filename: finalName,
        mimeType: "application/sla",
        base64: buf.toString("base64"),

        // spreadsheet fields
        orderNumber: `ORDER_${pad6(orderId)}`,
        sessionId: s.id,
        email,
        name,
        phone,
        addressSimple: simpleAddress,
        colorName,
        amount,

        // optional references
        packKey: s?.metadata?.packKey || "",
        modelKey: s?.metadata?.modelKey || ""
      };

      const r = await fetch(process.env.GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await r.text();
      let js;
      try {
        js = JSON.parse(text);
      } catch {
        js = null;
      }
      if (!js || !js.ok) {
        throw new Error(`Apps Script upload failed, status ${r.status}, ${js?.error || text}`);
      }
      fileData = {
        id: js.id,
        name: js.name,
        webViewLink: js.webViewLink,
        webContentLink: js.webContentLink
      };
    } else {
      throw new Error("No Drive uploader configured, set GAS_WEBAPP_URL or add a service account key");
    }

    if (req.file?.path) fs.unlinkSync(req.file.path);
    try {
      markUploaded(session_id, fileData, finalName);
    } catch (e) {
      console.error("markUploaded failed:", e);
    }
    inFlightUploads.delete(session_id);

    return res.json({ ok: true, file: { ...fileData, name: finalName } });
  } catch (e) {
    console.error("upload error:", e);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    inFlightUploads.delete(session_id);
    return res.status(500).json({ error: "drive_upload_failed", message: e?.message });
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
