const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));

// Replace these with your real values.
// Since your secret was exposed earlier, rotate it in Shopify first.
const SHOPIFY_API_KEY = "YOUR_SHOPIFY_API_KEY";
const SHOPIFY_API_SECRET = "YOUR_NEW_SHOPIFY_API_SECRET";

app.get("/", (req, res) => {
  res.send("SimplifyHQ backend working");
});

app.get("/install", (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  const redirectUri =
    "https://shopifyauth-vxoun7semq-uc.a.run.app/callback";

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=read_products,read_orders` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(installUrl);
});

app.get("/callback", async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send("Missing shop or code");
  }

  try {
    const response = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }
    );

    const accessToken = response.data.access_token;

    await db.collection("shops").doc(shop).set(
      {
        accessToken,
        shop,
        installedAt: new Date(),
      },
      { merge: true }
    );

    res.send("Shop connected successfully!");
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error connecting shop");
  }
});

app.get("/products", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  try {
    const shopDoc = await db.collection("shops").doc(shop).get();

    if (!shopDoc.exists) {
      return res.status(404).send("No store connected");
    }

    const token = shopDoc.data().accessToken;

    const response = await axios.get(
      `https://${shop}/admin/api/2023-10/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error fetching products");
  }
});

app.get("/sync-products", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  try {
    const shopDoc = await db.collection("shops").doc(shop).get();

    if (!shopDoc.exists) {
      return res.status(404).send("No store connected");
    }

    const token = shopDoc.data().accessToken;

    const response = await axios.get(
      `https://${shop}/admin/api/2023-10/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
        },
      }
    );

    const products = response.data.products || [];
    const batch = db.batch();

    products.forEach((product) => {
      const ref = db
        .collection("shops")
        .doc(shop)
        .collection("products")
        .doc(String(product.id));

      batch.set(
        ref,
        {
          id: product.id,
          title: product.title || "",
          handle: product.handle || "",
          status: product.status || "",
          vendor: product.vendor || "",
          productType: product.product_type || "",
          createdAt: product.created_at || null,
          updatedAt: product.updated_at || null,
          raw: product,
          syncedAt: new Date(),
        },
        { merge: true }
      );
    });

    await batch.commit();

    res.json({
      success: true,
      shop,
      savedProducts: products.length,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error syncing products");
  }
});

exports.shopifyAuth = onRequest(app);
