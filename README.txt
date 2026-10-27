# FileHush

### Everyday conversions. A little more private.

An open-source collection of browser-based tools for converting images, PDFs, documents, and structured data. Choose a file, convert it on your device, and save the result—without an account or file upload.

**[Open FileHush →](https://filehush-wine.vercel.app)** · **[MIT License](LICENSE)**

## What you can do

| Tool | Supported conversions | Details |
| --- | --- | --- |
| Image converter | JPG ↔ PNG ↔ WebP | Still images, optional JPG/WebP quality settings, and white backgrounds for JPG transparency. |
| Images to PDF | JPG/PNG → PDF | Combine and reorder images. One image per A4 page, proportional fit, and 12 mm margins. |
| PDF to images | PDF → JPG/PNG | Export all pages or a selected subset at 144 DPI, with individual downloads. |
| CSV ↔ JSON | CSV ↔ flat JSON object arrays | UTF-8 input, header-based CSV, and string-preserving CSV values. |
| DOCX to PDF | DOCX → preview → browser PDF printing | Review the layout, then use **Print / Save as PDF** where your browser supports it. |
| PDF to DOCX | Simple text-based PDF → editable DOCX | Approximate text and page layout. Unsupported content blocks conversion rather than producing partial output. |

One file is processed per job, except when combining multiple images into one PDF. Results stay temporary until you explicitly save them.

## Privacy by design

- **Local processing:** conversion runs in the browser. The application has no file-upload or server-side conversion endpoint.
- **No accounts or history:** the app does not persist file data or conversion history in browser storage.
- **Bundled resources:** conversion libraries, PDF workers, fonts, and support assets are served with the website. No runtime CDN scripts, remote fonts, or built-in analytics.
- **Clear and replace:** changing files, settings, or tools invalidates old results and releases app-held resources.

The website host still receives normal page and asset requests, including connection information. Browsers manage downloads and may use memory or disk. FileHush does not promise secure erasure or protection against browser extensions, compromised devices, or modified hosting code.

## Run locally

Use **Node.js 24 LTS, version 24.13 or later**, and npm.

```sh
git clone https://github.com/shuhaab/filehush.git
cd filehush
npm ci
npm run build
npm run dev
```

Open the URL printed in Terminal, normally **http://127.0.0.1:4173**. Stop the server with `Ctrl+C`.

The local server serves the existing `dist/` build. After editing application code, run `npm run build` again and refresh the browser; automatic rebuilding is not included. Serve `dist/` over HTTP rather than opening `index.html` directly from disk.

## Conversion limits

| Input or output | Current limit |
| --- | --- |
| Individual images | 10 MiB, 12 megapixels, and 8,192 pixels per side |
| Images combined into PDF | 12 images and 30 MiB combined input |
| PDF input | 15 MiB and 40 pages |
| Rendered PDF page images | 12 megapixels and 8,192 pixels per side |
| CSV/JSON input | 5 MiB, 10,000 records, and 200 columns |
| DOCX input | 8 MiB compressed, 30 MiB expanded, and 600 ZIP entries |
| PDF-to-DOCX extracted text | 500,000 characters |
| Generated output | 50 MiB per job, including all exported page images |

These are initial resource budgets, not a guarantee that every accepted file can be converted on every device. One MiB is 1,048,576 bytes.

## Important limitations

- **PDF to DOCX is intentionally limited.** It supports simple horizontal text and blank pages. Scanned pages, graphics/images, ambiguous columns, annotations/forms, rotated or RTL text, optional layers, attachments, and unreliable extraction are rejected. No OCR or screenshot substitution is used.
- **DOCX to PDF uses browser printing.** It does not offer an automatic PDF download or confirm that a PDF was saved. Fonts, pagination, and layout may differ from Word. External relationships, active content, legacy drawings, and unsupported embedded images are rejected; embedded fonts are ignored.
- **Image conversion re-encodes pixels.** Lossy output can lose detail, metadata and color profiles may change, and output can be larger than the input. Animated PNG/WebP, GIF, SVG, HEIC, and AVIF are unsupported. Same-format recompression, resizing, and editing are outside the current scope.
- **CSV/JSON conversion is not lossless type round-tripping.** CSV values stay strings, including leading zeros. JSON null/missing values become empty CSV cells; numbers and booleans become text. Nested data is rejected. Preserve long identifiers as strings.
- **Spreadsheet formulas are preserved.** Open untrusted CSV as text rather than allowing a spreadsheet to evaluate its contents.
- **Offline reloads are not guaranteed.** Conversion can continue after the relevant tool resources have loaded and the connection is lost; offline first visits, reloads, and installation are not supported.

Physical-phone testing, broad standalone-browser coverage, full manual screen-reader evaluation, long-run memory profiling, and actual saved print-to-PDF fidelity remain outstanding. Automated checks do not establish universal compatibility, perfect document fidelity, or WCAG certification.

## Development and testing

```sh
npm test          # Node tests, including Vercel header routing
npm run build     # Production build
npm run check     # Node tests, build, and production artifact checks
npm audit --omit=dev
```

To prepare the browser checks:

```sh
npm run test:browser:prepare
npm run dev
```

Open these paths on the local server and use their Run buttons:

| Path | Checks |
| --- | --- |
| `/qa.html` | Conversion, privacy, and disconnected operation |
| `/interactions.html` | UI workflows and axe accessibility checks |
| `/security.html` | Deliberate CSP violations and response-header checks |
| `/responsive.html` | Layout and larger-text checks at several widths |

Test fixtures are synthetic. Malformed and encrypted examples are intentional test inputs. The encrypted PDF uses the password `secret` and should be rejected. Test preparation regenerates fixtures and may change those files locally.

For the disconnected check, finish the `/qa.html` tests, keep the tab open, stop the local server, and click **Run disconnected checks**.

Run `npm run build` after browser testing to remove QA pages, fixtures, and source maps from `dist/`.

## Deploy your own copy

FileHush is a static website. It needs no database, conversion server, runtime secrets, or application environment variables.

For Vercel, import the repository with these settings:

| Setting | Value |
| --- | --- |
| Root directory | `./` |
| Framework preset | Other |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | Automatic |

The root [`vercel.json`](vercel.json) defines the build settings and security headers. Keep `cleanUrls` disabled so `/print.html` retains its document-preview policy. The application, print frame, and PDF worker require separate Content Security Policies.

For another static host, apply the policies in [`scripts/policy.mjs`](scripts/policy.mjs). The build also emits `dist/_headers` for hosts that support that format. Verify the actual served headers and PDF/DOCX behavior after deployment; a successful build alone does not verify the hosted security policy.

## Project structure

```text
src/           UI, styles, validation, and conversion functions
public/        Print-preview shell, print styles, and favicon
scripts/       Build, local server, fixtures, and artifact verification
test/          Node/browser tests and synthetic fixtures
index.html     Application shell
vercel.json    Vercel build and security-header configuration
dist/          Generated website; excluded from Git
```

Built with native browser Canvas APIs, PDF.js, pdf-lib, Papa Parse, docx, docx-preview, and fflate. esbuild bundles the application; axe-core supports accessibility checks. Dependencies are pinned in `package-lock.json`.

## Contributing

Bug reports and focused pull requests are welcome. Include reproduction steps, browser/OS details, expected behavior, and a synthetic sample when needed. Do not attach confidential documents, credentials, or personal data.

Run `npm run check` before submitting changes, plus the relevant browser checks for conversion or UI changes. Preserve local processing, input validation, accessible controls, and cleanup of stale work. Update the documentation when supported formats or conversion behavior change.

## License

[MIT](LICENSE) © 2026 Shuhaab Bhat.

Dependencies retain their own licenses. See [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt). Generated builds include dependency license texts in `dist/THIRD_PARTY_LICENSES.txt`; preserve those notices when redistributing a build.
