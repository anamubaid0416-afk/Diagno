[README.md](https://github.com/user-attachments/files/27643494/README.md)
# Diagno

Diagnostic lab and radiology transparency platform for Pakistan.

Diagno helps patients compare diagnostic labs using price clarity, report delivery, patient experience, home sampling, radiology availability, and transparency indicators.

## Environment variables

- `ANTHROPIC_API_KEY`: required for the Diagno assistant chat.
- `GOOGLE_CLOUD_VISION_API_KEY`: optional for receipt OCR.
- `AZURE_VISION_ENDPOINT`: optional for prescription reader Azure OCR.
- `AZURE_VISION_KEY`: optional for prescription reader Azure OCR.
- `OPENAI_API_KEY` or `GEMINI_API_KEY`: optional prescription interpretation layer.

## Prescription reader practice flow

1. Azure OCR reads the uploaded prescription image when Azure keys are configured.
2. GPT/OpenAI or Gemini can normalize OCR text into likely tests, scans, and medicines.
3. Local dictionary matching separates diagnostic tests/scans from common medicine names.
4. Human correction remains required before Diagno uses the output for lab comparison.
