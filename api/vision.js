function extractReceiptSignals(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const amountMatches = [...clean.matchAll(/(?:rs\.?|pkr|₨)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  const fallbackAmounts = [...clean.matchAll(/\b([0-9][0-9,]{2,}(?:\.\d{1,2})?)\b/g)]
    .map((match) => match[1]);

  const amounts = [...new Set([...amountMatches, ...fallbackAmounts])]
    .map((value) => Number(String(value).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);

  const dateMatch = clean.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/);
  const labHints = [
    "Aga Khan",
    "Chughtai",
    "IDC",
    "Islamabad Diagnostic",
    "Excel",
    "Essa",
    "Shifa",
    "Dow",
    "Indus",
    "Metropole",
    "Shaheen",
    "Zeenat",
    "Advance",
    "Advanced",
  ].filter((name) => new RegExp(name, "i").test(clean));

  return {
    likelyTotal: amounts[0] || null,
    amounts: amounts.slice(0, 8),
    date: dateMatch?.[0] || null,
    labHints,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Google Vision is not configured yet. Add GOOGLE_CLOUD_VISION_API_KEY in Vercel environment variables.",
    });
  }

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const content = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    if (!content || content.length < 100) {
      return res.status(400).json({ error: "Invalid image data" });
    }

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            imageContext: { languageHints: ["en", "ur"] },
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Google Vision error:", data);
      return res.status(response.status).json({ error: data?.error?.message || "Google Vision OCR failed" });
    }

    const annotation = data?.responses?.[0]?.fullTextAnnotation;
    const text = annotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";

    return res.status(200).json({
      text,
      signals: extractReceiptSignals(text),
    });
  } catch (error) {
    console.error("Vision handler error:", error);
    return res.status(500).json({ error: error.message || "Receipt OCR failed" });
  }
};
