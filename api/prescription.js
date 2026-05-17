// =====================================================================
// YourMessiah — Prescription OCR (patched)
//
// Reads a prescription image, extracts only test names and medicine names,
// sanitises PII before any external call or response, uses one AI provider
// (Anthropic) for normalisation, returns minimal data to the frontend.
//
// What this file does NOT do:
//   - Store the image (never written to disk)
//   - Return the raw OCR text to the patient's browser
//   - Send PII (patient name, doctor name, phone, etc.) to any AI provider
//   - Diagnose, suggest, interpret, or recommend anything
//   - Reveal internal pipeline details to the frontend
// =====================================================================

const TEST_DICTIONARY = [
  ["CBC",            ["cbc", "complete blood count", "blood count"]],
  ["HbA1c",          ["hba1c", "a1c", "glycated"]],
  ["Lipid Profile",  ["lipid", "cholesterol", "triglyceride"]],
  ["LFT",            ["lft", "liver function", "sgpt", "sgot", "alt", "ast"]],
  ["RFT",            ["rft", "renal function", "creatinine", "urea", "bun"]],
  ["TSH",            ["tsh", "thyroid", "tft"]],
  ["Vitamin D",      ["vitamin d", "vit d", "25-oh"]],
  ["FBS",            ["fbs", "fasting sugar", "fasting glucose"]],
  ["RBS",            ["rbs", "random sugar", "random glucose"]],
  ["Urine DR",       ["urine dr", "urine re", "urinalysis", "urine routine"]],
  ["Culture C/S",    ["urine culture", "urine c/s", "culture c/s", "culture and sensitivity"]],
  ["CRP",            ["crp", "c-reactive"]],
  ["ESR",            ["esr"]],
  ["Ferritin",       ["ferritin"]],
  ["Ultrasound",     ["ultrasound", "usg", "sonography"]],
  ["X-ray",          ["x-ray", "xray", "x ray"]],
  ["MRI",            ["mri"]],
  ["CT Scan",        ["ct scan", "ct brain", "ct chest", "ct abdomen"]],
  ["Doppler",        ["doppler"]],
  ["Mammography",    ["mammography", "mammogram"]],
];

const MEDICINE_DICTIONARY = [
  ["Panadol",        ["panadol", "paracetamol", "acetaminophen"]],
  ["Brufen",         ["brufen", "ibuprofen"]],
  ["Augmentin",      ["augmentin", "amoxiclav", "co-amoxiclav"]],
  ["Amoxil",         ["amoxil", "amoxicillin"]],
  ["Azomax",         ["azomax", "azithromycin"]],
  ["Klaricid",       ["klaricid", "clarithromycin"]],
  ["Flagyl",         ["flagyl", "metronidazole"]],
  ["Nexum",          ["nexum", "esomeprazole"]],
  ["Risek",          ["risek", "omeprazole"]],
  ["Glucophage",     ["glucophage", "metformin"]],
  ["Concor",         ["concor", "bisoprolol"]],
  ["Norvasc",        ["norvasc", "amlodipine"]],
  ["Lipiget",        ["lipiget", "atorvastatin", "lipitor"]],
  ["Thyroxine",      ["thyroxine", "levothyroxine", "eltroxin"]],
  ["Ventolin",       ["ventolin", "salbutamol", "albuterol"]],
  ["Rigix",          ["rigix", "cetirizine"]],
  ["Telfast",        ["telfast", "fexofenadine"]],
  ["Tegral",         ["tegral", "carbamazepine"]],
  ["Lexotanil",      ["lexotanil", "bromazepam"]],
];

// =====================================================================
// PII SANITISATION — runs on backend BEFORE any LLM call or response
// =====================================================================
function sanitisePrescriptionText(raw) {
  if (!raw) return "";
  let t = String(raw);

  const piiPatterns = [
    /(?:^|\n)\s*(?:patient|name|pt\.?|p\.?)\s*[:\-]\s*[^\n]+/gi,
    /(?:^|\n)\s*dr\.?\s+[a-z][^\n]*/gi,
    /(?:^|\n)\s*pmdc\s*[:#\-]?\s*\d+/gi,
    /(?:^|\n)\s*age\s*[:\-]\s*\d+\s*[a-z]*/gi,
    /(?:^|\n)\s*sex\s*[:\-]\s*(?:m|f|male|female)/gi,
    /(?:^|\n)\s*date\s*[:\-]\s*[^\n]+/gi,
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
    /\b03\d{2}[-\s]?\d{7}\b/g,
    /\b\d{11}\b/g,
    /\b\d{5}-\d{7}-\d\b/g,
    /(?:^|\n)\s*(?:address|add)\s*[:\-]\s*[^\n]+/gi,
    /(?:^|\n)\s*(?:phone|tel|cell|mob)\s*[:\-]?\s*[^\n]+/gi,
    /(?:^|\n)\s*(?:reg|mr|mrn|file)\s*[:#\-]\s*\d+/gi,
  ];
  for (const p of piiPatterns) t = t.replace(p, "");

  t = t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return t;
}

function stripDataUrl(imageBase64) {
  return String(imageBase64 || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

// =====================================================================
// WORD-BOUNDARY DICTIONARY MATCHING (replaces substring matching)
// =====================================================================
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function findMatches(text, dictionary) {
  const clean = String(text || "").toLowerCase();
  const found = [];
  for (const [label, terms] of dictionary) {
    for (const term of terms) {
      const pattern = new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, "i");
      if (pattern.test(clean)) {
        found.push(label);
        break;
      }
    }
  }
  return found;
}

// =====================================================================
// IMAGE SIZE GUARD
// =====================================================================
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
function imageIsTooLarge(base64) {
  return (String(base64 || "").length * 0.75) > MAX_IMAGE_BYTES;
}

// =====================================================================
// GOOGLE VISION OCR
// =====================================================================
async function runGoogleOcr(imageBase64) {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey || !imageBase64) return { text: "" };
  const content = stripDataUrl(imageBase64);
  if (!content || content.length < 100) return { text: "" };
  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            imageContext: { languageHints: ["en", "ur"] },
          }],
        }),
      }
    );
    if (!response.ok) {
      console.error("Vision OCR error:", response.status);
      return { text: "" };
    }
    const data = await response.json();
    const text =
      data?.responses?.[0]?.fullTextAnnotation?.text ||
      data?.responses?.[0]?.textAnnotations?.[0]?.description ||
      "";
    return { text };
  } catch (e) {
    console.error("Vision OCR exception:", e.message);
    return { text: "" };
  }
}

// =====================================================================
// ANTHROPIC NORMALISATION — single AI provider, strict prompt
// =====================================================================
async function normaliseWithAnthropic(sanitisedText, allowedTests, allowedMedicines) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!sanitisedText || sanitisedText.trim().length < 4) return null;

  const allowedTestsList    = allowedTests.map(t => t[0]).join(", ");
  const allowedMedicinesList = allowedMedicines.map(m => m[0]).join(", ");

  const systemPrompt =
    "You extract test names and medicine names from sanitised prescription OCR text. " +
    "Hard rules: " +
    "1) Return ONLY items that are clearly present in the input text. " +
    "2) Never invent or guess. If uncertain, omit. " +
    "3) Return ONLY items from these allowed lists. Reject anything else. " +
    `Allowed tests: ${allowedTestsList}. ` +
    `Allowed medicines: ${allowedMedicinesList}. ` +
    "4) Output strict JSON: {\"tests\":[\"...\"],\"medicines\":[\"...\"]}. No other keys, no commentary, no markdown.";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: sanitisedText }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.content?.[0]?.text || "";
    try {
      // Find JSON in response (handle markdown fencing if model added it)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr);
      const tests     = Array.isArray(parsed.tests)     ? parsed.tests     : [];
      const medicines = Array.isArray(parsed.medicines) ? parsed.medicines : [];
      const testSet = new Set(allowedTests.map(t => t[0]));
      const medSet  = new Set(allowedMedicines.map(m => m[0]));
      return {
        tests:     tests.filter(x => testSet.has(x)),
        medicines: medicines.filter(x => medSet.has(x)),
      };
    } catch (_) {
      return null;
    }
  } catch (e) {
    console.error("Anthropic exception:", e.message);
    return null;
  }
}

// =====================================================================
// HANDLER
// =====================================================================
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, manualText } = req.body || {};

    if (imageBase64 && imageIsTooLarge(imageBase64)) {
      return res.status(413).json({ error: "Image too large. Maximum 5 MB." });
    }

    // 1. OCR
    const ocr = await runGoogleOcr(imageBase64);

    // 2. Combine + sanitise BEFORE anything else touches the text
    const combinedRaw = [ocr.text, manualText].filter(Boolean).join("\n");
    const sanitised   = sanitisePrescriptionText(combinedRaw);

    // 3. Dictionary matching on the sanitised text
    const dictionaryTests     = findMatches(sanitised, TEST_DICTIONARY);
    const dictionaryMedicines = findMatches(sanitised, MEDICINE_DICTIONARY);

    // 4. AI normalisation on the sanitised text (one provider only)
    const aiResult = await normaliseWithAnthropic(sanitised, TEST_DICTIONARY, MEDICINE_DICTIONARY);

    // 5. Union of dictionary + AI results, de-duplicated
    const testsSet     = new Set(dictionaryTests);
    const medicinesSet = new Set(dictionaryMedicines);
    if (aiResult) {
      aiResult.tests.forEach(t => testsSet.add(t));
      aiResult.medicines.forEach(m => medicinesSet.add(m));
    }

    return res.status(200).json({
      tests:     Array.from(testsSet),
      medicines: Array.from(medicinesSet),
      disclaimer:
        "This is an extraction tool, not medical advice. " +
        "Please confirm the tests below before we compare labs. " +
        "We do not store your prescription — the image is discarded after processing.",
    });
  } catch (error) {
    console.error("Prescription handler error:", error);
    return res.status(500).json({ error: "Prescription reader failed" });
  }
};
