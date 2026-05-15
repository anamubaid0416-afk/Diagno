const TEST_DICTIONARY = [
  ["CBC", ["cbc", "complete blood count", "blood count"]],
  ["HbA1c", ["hba1c", "hb a1c", "a1c"]],
  ["Lipid Profile", ["lipid", "cholesterol", "triglyceride"]],
  ["LFT", ["lft", "liver function", "sgpt", "sgot", "alt", "ast"]],
  ["RFT", ["rft", "renal function", "creatinine", "urea"]],
  ["TSH", ["tsh", "thyroid"]],
  ["Vitamin D", ["vit d", "vitamin d", "25-oh"]],
  ["Urine DR", ["urine", "urinalysis", "urine dr", "urine re"]],
  ["CRP", ["crp"]],
  ["ESR", ["esr"]],
  ["Ferritin", ["ferritin"]],
  ["Ultrasound", ["ultrasound", "usg"]],
  ["X-ray", ["xray", "x-ray", "x ray"]],
  ["MRI", ["mri"]],
  ["CT Scan", ["ct scan", "ct brain", "ct"]],
  ["Doppler", ["doppler"]],
  ["Mammography", ["mammography", "mammogram"]],
];

const MEDICINE_DICTIONARY = [
  ["Panadol", ["panadol", "paracetamol", "acetaminophen"]],
  ["Brufen", ["brufen", "ibuprofen"]],
  ["Augmentin", ["augmentin", "amoxiclav", "amoxicillin clavulanate"]],
  ["Azomax", ["azomax", "azithromycin"]],
  ["Flagyl", ["flagyl", "metronidazole"]],
  ["Nexum", ["nexum", "esomeprazole"]],
  ["Risek", ["risek", "omeprazole"]],
  ["Glucophage", ["glucophage", "metformin"]],
  ["Concor", ["concor", "bisoprolol"]],
  ["Norvasc", ["norvasc", "amlodipine"]],
  ["Lipiget", ["lipiget", "atorvastatin"]],
  ["Thyroxine", ["thyroxine", "levothyroxine", "eltroxin"]],
  ["Ventolin", ["ventolin", "salbutamol", "albuterol"]],
  ["Rigix", ["rigix", "cetirizine"]],
  ["Telfast", ["telfast", "fexofenadine"]],
];

function stripDataUrl(imageBase64) {
  return String(imageBase64 || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function findMatches(text, dictionary) {
  const clean = String(text || "").toLowerCase();
  return dictionary
    .filter(([, terms]) => terms.some((term) => clean.includes(term)))
    .map(([label]) => ({ name: label, confidence: "dictionary" }));
}

function splitLikelyLines(text) {
  return String(text || "")
    .split(/\n|,|;|\|/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .slice(0, 30);
}

async function runGoogleOcr(imageBase64) {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey || !imageBase64) {
    return { configured: false, text: "", status: "Google Vision OCR not configured" };
  }

  const content = stripDataUrl(imageBase64);
  if (!content || content.length < 100) {
    return { configured: true, text: "", status: "No valid image data for Google Vision OCR" };
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
    return { configured: true, text: "", status: `Google Vision OCR failed: ${data?.error?.message || response.status}` };
  }

  const text = data?.responses?.[0]?.fullTextAnnotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
  return { configured: true, text, status: text ? "Google Vision OCR complete" : "Google Vision found no readable text" };
}

async function callOpenAi(text) {
  if (!process.env.OPENAI_API_KEY) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "Extract likely diagnostic tests, scans, and medicine names from prescription OCR text. Do not diagnose. Return compact JSON with tests, scans, medicines, unclear." },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return { provider: "OpenAI", raw: data.choices?.[0]?.message?.content || "" };
}

async function callGemini(text) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Extract likely diagnostic tests, scans, and medicine names from this prescription OCR text. Do not diagnose. Return JSON only.\n\n${text}` }] }],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return { provider: "Gemini", raw: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
}

async function callAnthropic(text) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: "Extract likely diagnostic tests, scans, and medicine names from prescription OCR text. Do not diagnose. Return compact JSON with tests, scans, medicines, unclear.",
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return { provider: "Anthropic", raw: data.content?.[0]?.text || "" };
}

async function interpretWithAi(text) {
  if (!text || text.trim().length < 2) {
    return { provider: "Fallback", raw: "", status: "No readable text for AI interpretation" };
  }

  try {
    const result = await callOpenAi(text) || await callGemini(text) || await callAnthropic(text);
    return result ? { ...result, status: `${result.provider} interpretation complete` } : { provider: "Fallback", raw: "", status: "No AI interpretation key configured" };
  } catch (error) {
    return { provider: "Fallback", raw: "", status: `AI interpretation unavailable: ${error.message}` };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, manualText } = req.body || {};
    const ocr = await runGoogleOcr(imageBase64);
    const combinedText = [ocr.text, manualText].filter(Boolean).join("\n").trim();
    const ai = await interpretWithAi(combinedText);
    const tests = findMatches(combinedText, TEST_DICTIONARY);
    const medicines = findMatches(combinedText, MEDICINE_DICTIONARY);

    return res.status(200).json({
      pipeline: [
        { step: "Google Vision OCR", status: ocr.status, complete: Boolean(ocr.text) },
        { step: "GPT/Gemini/OpenAI interpretation", status: ai.status, complete: ai.provider !== "Fallback" },
        { step: "Medicine database matching", status: `${medicines.length} possible medicine match${medicines.length === 1 ? "" : "es"}`, complete: medicines.length > 0 },
        { step: "Human correction fallback", status: "Editable confirmation is required before lab comparison", complete: true },
      ],
      text: combinedText,
      lines: splitLikelyLines(combinedText),
      tests,
      medicines,
      ai,
      disclaimer: "Prescription reader is for extraction practice only. It does not diagnose, treat, or replace doctor/pharmacist confirmation.",
    });
  } catch (error) {
    console.error("Prescription handler error:", error);
    return res.status(500).json({ error: error.message || "Prescription reader failed" });
  }
};
