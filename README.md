# Hisaab - Indian Bill Splitter

Hisaab is a modern, mobile-friendly bill splitting web app built for Indian restaurant bills. It supports menu-level participant selection, equal or custom item splits, GST, settlement-only rounding, payer reimbursements, AI bill scanning, and downloadable PNG summaries.

<!-- app-version -->
**Current stable version:** `v1.0.1`

## Live App

**[hisaab-by-anindya.vercel.app](https://hisaab-by-anindya.vercel.app)**

## Features

- Add and remove people from a bill.
- Add menu items with a unit price and quantity.
- Press Enter to add people and menu items.
- Choose participants separately for every menu item.
- Split an item equally or assign custom rupee amounts.
- Add configurable GST, enabled at 5% by default.
- Allocate GST proportionally to each person's food consumption.
- Select the person who paid and record the actual paid amount.
- Show an exact person-by-person consumption and GST breakdown.
- Round only the final repayments in the **Who pays whom** section.
- Upload or photograph a restaurant bill.
- Extract restaurant name, item names, quantities, and prices with LlamaExtract.
- Fall back automatically to browser-based Tesseract OCR when cloud OCR is unavailable.
- Auto-fill an empty Rendezvous field from the scanned restaurant name.
- Review and edit every detected item before importing it.
- Export a high-resolution styled PNG settlement summary.
- Use Indian rupee formatting through `Intl.NumberFormat('en-IN')`.
- Work on desktop and mobile with no frontend framework or build step.

## Technology

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Cloud OCR | LlamaExtract v2 through LlamaCloud |
| OCR fallback | Tesseract.js 5 |
| Backend | Vercel Node.js serverless function |
| Hosting | Vercel |
| Image export | Browser Canvas API |
| Fonts | DM Serif Display and Manrope |

## Architecture

```mermaid
flowchart TD
    A[Browser] --> B[index.html]
    B --> C[app.js state and calculations]
    B --> D[styles.css responsive UI]
    A -->|Bill image| E[/api/scan-bill]
    E -->|Server-side API key| F[LlamaCloud Files API]
    F --> G[LlamaExtract structured extraction]
    G --> E
    E -->|Validated JSON| C
    E -. unavailable .-> H[Tesseract.js browser fallback]
    H --> C
    C --> I[Editable OCR review]
    C --> J[Settlement summary]
    J --> K[PNG export]
```

The LlamaCloud key is never sent to the browser. The browser calls the same-origin Vercel endpoint, and only the serverless function reads `LLAMA_CLOUD_API_KEY`.

## Project Structure

```text
BillSplit/
|-- api/
|   `-- scan-bill.js       # Secure LlamaExtract serverless endpoint
|-- .env.example           # Safe environment variable template
|-- .gitignore             # Excludes secrets and Vercel metadata
|-- app.js                 # State, UI rendering, calculations, OCR, export
|-- index.html             # Semantic application structure
|-- styles.css             # Responsive dark glass-style interface
|-- vercel.json            # Function duration, memory, and API headers
`-- README.md              # Project and reconstruction guide
```

Never commit `.env.local` or `.vercel/`. Both are ignored intentionally.

## Application Flow

The interface is intentionally ordered around how a bill is prepared:

1. **Rendezvous**: Enter an event/place, or leave it empty for bill scanning to detect the restaurant name.
2. **People**: Add everyone participating in the bill.
3. **Menu Items**: Scan a bill or add items manually, then select item participants.
4. **Charges**: Enable GST and settlement repayment rounding.
5. **Payment**: Select who paid and confirm the amount paid.
6. **Summary**: Calculate exact shares and repayments, then export a PNG.

## Core State Model

The frontend uses one in-memory `state` object. No personal or bill data is persisted in local storage.

```js
const state = {
  people: [],
  items: [],
  scannedItems: [],
  nextPersonId: 1,
  nextItemId: 1,
  nextScannedItemId: 1,
  billPreviewUrl: '',
  isScanning: false,
  payerAmountTouched: false,
  latestBill: null
};
```

A person uses this shape:

```js
{
  id: 1,
  name: 'Aditi'
}
```

A menu item uses this shape:

```js
{
  id: 1,
  name: 'Paneer Tikka',
  unitPricePaise: 19000,
  quantity: 2,
  pricePaise: 38000,
  mode: 'equal',
  participantIds: [1, 2],
  customShares: {}
}
```

## Money and Rounding Rules

All calculations use integer paise, not floating-point rupee values.

```js
function toPaise(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}
```

This prevents errors such as `0.1 + 0.2 !== 0.3` from changing a settlement.

### Equal Item Splits

An item's paise value is divided by the selected participant count. Any remaining paise is distributed one at a time in participant order, so every allocated share always sums exactly to the item price.

### Custom Item Splits

Every selected participant gets an editable rupee input. Calculation is blocked until custom shares add up exactly to the item's line total.

### GST Allocation

GST is calculated from the menu subtotal and distributed proportionally according to each person's pre-tax consumption. A largest-remainder allocation ensures the distributed GST adds up exactly to the bill GST.

### Actual Payment Differences

If the payer's recorded payment differs from the calculated bill total, repayment shares are scaled proportionally to the actual amount paid. The summary displays an explanatory adjustment note.

### Repayment Rounding

Food shares, GST, and calculated totals remain exact. Only non-payer transfers shown under **Who pays whom** are rounded to the nearest rupee. The payer absorbs the small rounding difference.

## Bill Scanning Architecture

### Browser Preparation

The browser:

1. Validates JPG, PNG, or WebP files up to 12 MB.
2. Displays the original image locally for preview.
3. Resizes the image to a maximum dimension of 1800 pixels.
4. Converts it to JPEG at 84% quality.
5. Sends the compressed base64 image to `/api/scan-bill`.

This keeps requests below serverless body limits while preserving readable receipt text.

### Serverless Start Request

```http
POST /api/scan-bill
Content-Type: application/json

{
  "mimeType": "image/jpeg",
  "imageBase64": "..."
}
```

The endpoint validates the payload, applies basic per-IP rate limiting, uploads the image to LlamaCloud, and starts a LlamaExtract job. It returns:

```json
{
  "jobId": "ext-...",
  "status": "PENDING"
}
```

### Polling Request

```http
GET /api/scan-bill?jobId=ext-...
```

Pending jobs return HTTP `202`. A completed job returns:

```json
{
  "status": "COMPLETED",
  "provider": "LlamaExtract",
  "venueName": "Taj Spice House",
  "items": [
    {
      "name": "Paneer Tikka",
      "quantity": 2,
      "unitPrice": 190,
      "lineTotal": 380
    }
  ],
  "totals": {
    "subtotal": 380,
    "gst": 19,
    "total": 399
  }
}
```

### Extraction Schema

`api/scan-bill.js` sends a JSON Schema to LlamaExtract for:

- `venue_name`
- `items[].name`
- `items[].quantity`
- `items[].unit_price`
- `items[].line_total`
- `subtotal`
- `gst`
- `total`

The API uses the `cost_effective` tier by default, disables result caching, processes one page, and excludes totals/taxes from item rows through schema descriptions, a system prompt, and server-side validation.

### Tesseract Fallback

When the serverless endpoint is missing, unconfigured, offline, rate-limited, or unsuccessful, `scanBillImage()` calls Tesseract.js in the browser.

The local parser supports common receipt rows such as:

```text
2 Paneer Tikka 190.00 380.00
Paneer Tikka 2 190.00 380.00
2 x Paneer Tikka 380.00
Paneer Tikka 190.00
```

Tax, subtotal, total, service charge, invoice, and payment rows are filtered out. Because OCR is not perfect, every detected row must remain editable before import.

## Rebuilding the App From Scratch

### 1. Create the Frontend Files

Create `index.html`, `styles.css`, and `app.js`. Link the stylesheet and load Tesseract before the application script:

```html
<link rel="stylesheet" href="styles.css">
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" defer></script>
<script src="app.js" defer></script>
```

### 2. Build the Semantic Sections

Create independent sections for Rendezvous, People, Menu Items, Charges, Payment, Calculate, and Summary. Give all interactive elements stable IDs because `app.js` caches them in an `elements` object.

### 3. Implement People

Store each person with a numeric ID. Render removable chips. When a person is removed, also remove their ID and custom share from every menu item.

### 4. Implement Menu Items

Treat the entered price as a per-unit price. Calculate line total with:

```js
pricePaise = unitPricePaise * quantity;
```

Default new items to equal mode and include all current people. Use a `<details>` dropdown with checkboxes for item-level participant selection. Keep the dropdown open after a checkbox re-render.

### 5. Implement Split Modes

For equal mode, use an integer-paise remainder algorithm. For custom mode, render one amount input per selected person and require the custom total to match the item line total.

### 6. Implement GST

Calculate GST from the subtotal, then use proportional largest-remainder allocation. Keep a separate map for food consumption, GST, and final exact shares.

### 7. Implement Settlements

Allocate the payer's actual payment proportionally across exact final shares. Round only non-payer repayment transfers when enabled. Set the payer's own effective share to the paid amount minus all reimbursements.

### 8. Add Cloud OCR

Create `api/scan-bill.js`. Keep the API key in `process.env.LLAMA_CLOUD_API_KEY`. Implement separate POST and GET behavior so the browser can poll without keeping one serverless invocation open.

### 9. Add OCR Review

Map returned items into editable draft rows. Import only selected, valid rows into the normal menu-item state so scanned and manual items follow exactly the same calculation path.

### 10. Add PNG Export

After calculation, save a normalized snapshot in `state.latestBill`. Draw the final image with Canvas API primitives instead of screenshotting the DOM. This produces a consistent high-resolution file independent of screen size.

### 11. Add Responsive Styling

Use CSS variables for colors and spacing, grid for desktop sections, and media queries at 820px and 560px. Keep OCR review rows readable on mobile and ensure `document.documentElement.scrollWidth <= window.innerWidth`.

## Local Development

### Requirements

- Node.js 20 or newer
- npm
- A LlamaCloud API key
- Vercel CLI through `npx`

### Configure Environment Variables

Create `.env.local` from `.env.example` and provide your own key:

```env
LLAMA_CLOUD_API_KEY=your_llamacloud_key
LLAMA_CLOUD_PROJECT_ID=
LLAMA_EXTRACT_TIER=cost_effective
```

`LLAMA_CLOUD_PROJECT_ID` is optional unless the API key needs an explicit project. Supported extraction tiers are `cost_effective`, `agentic`, `agentic_plus`, and `turbo`.

### Run Locally With the API

```powershell
npx.cmd vercel@latest dev
```

Open the local URL printed by Vercel. Opening `index.html` directly still runs the app, but cloud OCR falls back to Tesseract because there is no `/api/scan-bill` server.

## Deploying to Vercel

### Link the Project

```powershell
npx.cmd vercel@latest login
npx.cmd vercel@latest link
```

### Add the Production Secret

```powershell
npx.cmd vercel@latest env add LLAMA_CLOUD_API_KEY production
```

Optionally add `LLAMA_CLOUD_PROJECT_ID` and `LLAMA_EXTRACT_TIER` through the Vercel dashboard or CLI.

### Deploy

```powershell
npx.cmd vercel@latest deploy --prod
```

The project currently uses the production domain:

```text
https://hisaab-by-anindya.vercel.app
```

## Versioning and Releases

The project follows [Semantic Versioning](https://semver.org/):

| Change | Version example | Use when |
|---|---|---|
| Patch | `1.0.0` → `1.0.1` | Bug fix, copy change, styling fix, or small safe adjustment |
| Minor | `1.0.0` → `1.1.0` | Backward-compatible feature or meaningful capability |
| Major | `1.0.0` → `2.0.0` | Breaking workflow, API, data model, or deployment change |

Every production deployment must have a version greater than the previous production version. Never reuse, move, or delete a published version tag.

The version is recorded in four synchronized places:

- `package.json`
- `version.json`
- `<meta name="application-version">` in `index.html`
- The visible footer version in `index.html`

The version helper updates all four locations and the version shown at the top of this README.

### Bump a Version

For a patch release:

```powershell
npm run version:patch
```

For a feature release:

```powershell
npm run version:minor
```

For a breaking release:

```powershell
npm run version:major
```

Set an explicit version when needed:

```powershell
npm run version:set -- 1.2.3
```

### Production Release Checklist

1. Start from a clean `main` branch.
2. Make and test the application changes.
3. Run `npm run check`.
4. Select the correct patch, minor, or major version bump.
5. Review `git diff` and confirm no secret file is staged.
6. Commit the code and version metadata together.
7. Create an annotated immutable Git tag.
8. Push `main` and the tag to GitHub.
9. Deploy to Vercel production.
10. Create a GitHub Release and record both the stable URL and immutable Vercel deployment URL.

Example for version `1.0.1`:

```powershell
npm run check
npm run version:patch
git add app.js index.html styles.css api package.json version.json README.md
git commit -m "Release v1.0.1"
git tag -a v1.0.1 -m "Hisaab v1.0.1"
git push origin main
git push origin v1.0.1
npx.cmd vercel@latest deploy --prod
gh release create v1.0.1 --title "Hisaab v1.0.1" --notes "Describe the release and include its immutable Vercel deployment URL."
```

The example file list is not exhaustive. Stage every intended source file, but never stage `.env.local` or `.vercel/`.

### Roll Back the Live Site

Each GitHub Release should contain the immutable Vercel deployment URL produced during that version's deployment. To make a previous deployment live immediately:

```powershell
npx.cmd vercel@latest rollback previous-immutable-deployment.vercel.app --yes
```

This moves the production alias back without deleting newer source, commits, tags, or deployments.

The same action is available in the Vercel dashboard: open **Deployments**, choose the desired successful deployment, and promote or roll it back to Production.

### Restore Source From a Version

Tags are immutable source snapshots. Inspect an old release without changing the current working tree:

```powershell
git show v1.0.0
```

Create an isolated worktree when an exact old version must be rebuilt or deployed:

```powershell
git worktree add ..\hisaab-v1.0.0 v1.0.0
Push-Location ..\hisaab-v1.0.0
npx.cmd vercel@latest deploy --prod
Pop-Location
git worktree remove ..\hisaab-v1.0.0
```

For a normal code rollback, prefer `git revert` on the unwanted commits, then publish a new patch version. This preserves history and keeps every released tag trustworthy.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `LLAMA_CLOUD_API_KEY` | Yes | None | Authenticates server-side LlamaCloud requests |
| `LLAMA_CLOUD_PROJECT_ID` | No | API key default | Selects a LlamaCloud project explicitly |
| `LLAMA_EXTRACT_TIER` | No | `cost_effective` | Controls extraction quality, latency, and credits |

## Security

- Never place `LLAMA_CLOUD_API_KEY` in `app.js`, HTML, Git, screenshots, or browser storage.
- Keep `.env.local` and `.vercel/` ignored.
- The API accepts only JPG, PNG, and WebP payloads.
- Browser uploads are resized and compressed before transmission.
- The endpoint limits prepared images to approximately 3 MB.
- Extraction job IDs are validated before polling.
- POST requests are limited per IP on each warm serverless instance.
- LlamaExtract result caching is disabled.
- Review Vercel logs without logging request image data or authorization headers.

For a high-traffic public deployment, replace the in-memory rate limit with a persistent service such as Upstash Redis and add bot protection.

## Validation Checklist

Before deploying a change, verify:

- `node --check app.js`
- `node --check api/scan-bill.js`
- People can be added and removed.
- Enter submits people and menu items.
- Quantity changes the line total.
- Item participant dropdown stays open while selecting people.
- Equal splits preserve every paise.
- Custom shares must equal the item total.
- GST allocations sum to the displayed GST.
- Repayment rounding does not change food/GST totals.
- Existing Rendezvous text is not overwritten by OCR.
- Empty Rendezvous is filled when a venue is detected.
- LlamaExtract results appear in the review table.
- Tesseract fallback works when `/api/scan-bill` is unavailable.
- PNG export includes totals and repayment instructions.
- The page has no horizontal overflow at 390px width.
- `/api/scan-bill` returns `503 OCR_NOT_CONFIGURED` without an API key rather than exposing a secret.

## Troubleshooting

### Cloud OCR Always Uses Tesseract

Confirm `LLAMA_CLOUD_API_KEY` exists in the correct Vercel environment and redeploy after adding or changing environment variables.

### OCR Returns No Items

Use a sharp, straight photo with strong lighting. Avoid folded receipts, shadows, cropped item columns, and screenshots with excessive surrounding background.

### API Returns 413

The prepared image is too large. Reduce the maximum image dimension or JPEG quality in `prepareBillImage()`.

### API Returns 429

The scan rate limit was reached. Wait for the `Retry-After` period or replace the simple limiter with persistent rate limiting.

### Custom Shares Cannot Calculate

The selected custom amounts must add up exactly to the menu item's quantity-adjusted line total.

### New Production Code Is Not Visible

Deploy the local linked project again:

```powershell
npx.cmd vercel@latest deploy --prod
```

## Known Limitations

- Bill data is held only in memory and disappears on refresh.
- One payer is supported per bill.
- OCR quality depends on photo quality and receipt layout.
- Tesseract fallback recognizes English text only.
- The in-memory API rate limit is per warm serverless instance, not globally distributed.
- LlamaCloud usage is subject to the account's credits and provider pricing.

## Suggested Future Improvements

- Save and restore draft bills locally.
- Support multiple payers and partial payments.
- Add receipt PDF upload.
- Add Hindi and regional-language OCR models.
- Add shareable read-only settlement links.
- Add persistent global rate limiting and bot protection.
- Add automated unit tests for money allocation functions.
- Add end-to-end browser tests in CI.
- Add a service worker for offline manual bill splitting.

## Author

Made with love by **A N I N D Y A**.
