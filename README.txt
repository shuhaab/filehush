FileHush

Browser-only file conversion. Files are processed on your device.
No uploads, accounts, database, analytics or persistent file history.

Requirements:
Node.js 24 LTS, version 24.13 or later.

Install and run:
npm ci
npm run build
npm run dev

Checks:
npm run check

Tools:
JPG/PNG/WebP conversion, images to PDF, PDF to images,
CSV/JSON conversion, DOCX preview for browser PDF printing,
and simple text-based PDF to editable DOCX.

Limitations:
No OCR. PDF-to-DOCX supports simple horizontal text and blank pages.
Unsupported complex content is rejected. Document layout is approximate.
DOCX-to-PDF requires the browser Print / Save as PDF dialog.
Physical-phone testing remains outstanding.

License:
MIT. Dependencies retain their respective licenses.
See THIRD_PARTY_NOTICES.txt.
