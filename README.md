# SalesPulse BI: Sales Analytics & Forecasting Dashboard

SalesPulse BI (repository name `sales_Dashboard`) is a full-stack sales analytics application. You upload a CSV or Excel export of order lines, a background worker validates and loads the data into MongoDB while the browser shows live progress, and the dashboard then presents KPIs, revenue trends, a sales forecast, category and region breakdowns, top products and top customers. Everything can be filtered by date range, category and region.

> **Documentation map**
>
> | Document | What it covers |
> |---|---|
> | **README.md** (this file) | What the project is, how to install, configure, run, test and troubleshoot it |
> | [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | MongoDB collections, fields, indexes, aggregation pipelines, data lifecycle |
> | [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Every REST endpoint and WebSocket event, with parameters, responses and errors |
> | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flows and the reasoning behind the technical decisions |

---

## Table of contents

1. [Features](#1-features)
2. [Tech stack](#2-tech-stack)
3. [How it works at a glance](#3-how-it-works-at-a-glance)
4. [Repository structure](#4-repository-structure)
5. [Prerequisites](#5-prerequisites)
6. [Installation and setup](#6-installation-and-setup)
7. [Configuration reference](#7-configuration-reference)
8. [Running the project](#8-running-the-project)
9. [Using the dashboard](#9-using-the-dashboard)
10. [Input file format](#10-input-file-format)
11. [Sample data](#11-sample-data)
12. [Available scripts](#12-available-scripts)
13. [Testing](#13-testing)
14. [Deployment notes](#14-deployment-notes)
15. [Troubleshooting](#15-troubleshooting)
16. [Known limitations](#16-known-limitations)

---

## 1. Features

**Data ingestion**

- Upload `.csv` or `.xlsx` files up to 50 MB (configurable).
- Asynchronous processing: the upload request returns immediately (HTTP 202) while a BullMQ worker does the heavy lifting.
- Live progress over Socket.io, with a REST polling fallback in the browser.
- CSV files are streamed, so memory stays flat even for very large files. Separators (comma, semicolon, tab, pipe) are detected automatically.
- Fuzzy column matching: `Order Date`, `order_date` and `Date` are all recognised as the order date. Many common aliases are supported (see [section 10](#10-input-file-format)).
- Automatic day-first versus month-first date detection per file.
- Row-level validation with **quarantine**: invalid rows are skipped and listed (row number, column, reason) instead of failing the whole file. The quarantine report can be downloaded as a CSV from the UI.

**Analytics dashboard**

- Five KPI cards: Total Revenue, Total Orders, Total Customers, Average Order Value, Revenue Growth.
- Revenue trend chart with daily, weekly or monthly granularity. Periods with no sales appear as zero so a slump is visible.
- Sales forecast chart: history plus projected months, using 70% linear regression and 30% weighted moving average, with an R-squared confidence badge.
- Revenue share by category or by region (donut chart).
- Top 10 products by revenue, viewable as a chart, a table, or both side by side.
- Customer leaderboard table with search, sortable columns and pagination.
- Global filters: start date, end date, categories (multi-select), regions (multi-select).

**Dataset management**

- Every upload becomes a separate dataset ("batch"). Switch between datasets from a dropdown without re-uploading.
- Delete a dataset and all of its records from the UI.
- The last selected dataset is remembered in the browser.

**Operational quality**

- Rate limiting, security headers, CORS allow-list, request size limits.
- Health endpoints for liveness and readiness.
- Graceful shutdown, fail-fast start-up checks, throttled Redis outage logging.
- In-memory response cache for finished datasets.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Client framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Client styling and UI | Tailwind CSS 4, lucide-react icons, Geist fonts |
| Charts | Recharts 3 |
| Client networking | Axios (REST), socket.io-client (real-time), react-dropzone (file input) |
| Server runtime | Node.js 20 or newer, ES modules |
| Server framework | Express 5 |
| Database | MongoDB, accessed through Mongoose 9 |
| Job queue | BullMQ 6 on Redis (ioredis 6) |
| Real-time | Socket.io 4 |
| Validation | Zod 4 |
| File parsing | csv-parser (streamed CSV), read-excel-file (Excel) |
| Analytics | MongoDB aggregation pipelines, simple-statistics, dayjs |
| Hardening | helmet, cors, compression, express-rate-limit, multer |
| Server tests | Node's built-in test runner (`node --test`) |

---

## 3. How it works at a glance

```
 Browser (Next.js)
   |  1. POST /uploads (file)          ^  5. live progress (Socket.io)
   v                                   |
 Express API ---- 2. queue job ---> Redis (BullMQ) ---- 3. job ---> Worker
   |                                                                  |
   |  6. GET /analytics/*  (aggregations)                             | 4. validate rows,
   v                                                                  v    bulk insert
 MongoDB  <-----------------------------------------------------------+
 (uploadbatches, salesrecords)
```

1. The browser uploads a file; the API stores it temporarily on disk and creates an upload batch record.
2. The API puts a job on a Redis-backed queue and answers right away.
3. A worker picks up the job, streams the file, validates each row and bulk-inserts valid rows into MongoDB.
4. Progress and completion events travel worker, Redis, API, Socket.io, browser.
5. The dashboard asks the API for KPIs, trends, breakdowns and a forecast. MongoDB aggregation pipelines compute them.

For the full story see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 4. Repository structure

```
sales_Dashboard/
├── client/                           Next.js dashboard
│   ├── app/
│   │   ├── layout.tsx                Root layout, fonts, FilterProvider
│   │   ├── page.tsx                  The dashboard page (data loading + layout)
│   │   └── globals.css
│   ├── api/
│   │   ├── axiosInstance.ts          Axios setup, error normalisation, query serializer
│   │   ├── analytics.api.ts          Typed API functions and response adapters
│   │   └── socket.ts                 Socket.io singleton and batch subscription helper
│   ├── components/
│   │   ├── charts/                   RevenueTrendChart, ForecastChart,
│   │   │                             CategoryPieChart, TopProductsBarChart
│   │   ├── kpi/KpiCardGrid.tsx       The five KPI cards
│   │   ├── layout/                   Sidebar, TopFilterBar
│   │   ├── tables/CustomerSalesTable.tsx
│   │   └── upload/                   FileDropzone, ValidationModal (+ DataHealthBanner)
│   ├── context/FilterContext.tsx     Global state: datasets, filters, modals
│   └── types/dashboard.types.ts      Shared TypeScript types
├── server/
│   ├── .env.example                  Template for server configuration
│   ├── src/
│   │   ├── server.js                 Entry point (DB, Redis, HTTP, Socket.io, worker)
│   │   ├── app.js                    Express app, middleware, health routes
│   │   ├── config/                   db.config.js, redis.config.js
│   │   ├── routes/api.routes.js      Route table
│   │   ├── controllers/              upload.controller.js, analytics.controller.js
│   │   ├── services/                 fileParser, kpi, forecast
│   │   ├── models/                   SalesRecord.model.js, UploadBatch.model.js
│   │   ├── queues/upload.queue.js    BullMQ producer + QueueEvents -> Socket.io bridge
│   │   ├── workers/upload.worker.js  BullMQ consumer (the ingestion pipeline)
│   │   ├── validators/               salesRow.schema.js (Zod)
│   │   ├── middlewares/              upload.middleware.js, error.middleware.js
│   │   └── utils/                    cache, dateOrder, headerMapper, uploadMappers
│   └── test/                         8 test files
├── sample-data/                      MOCK_DATA(1).csv and MOCK_DATA(1).xlsx (1,000 rows each)
└── README.md
```

---

## 5. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | Required by the server (`engines` field). Use the same version for the client |
| npm | Comes with Node | The repository contains `package-lock.json` files, so npm is the expected package manager |
| MongoDB | Any currently supported version (the Docker example below uses 7) | Local install, Docker, or MongoDB Atlas |
| Redis | Any currently supported version (the Docker example below uses 7) | Local install, Docker, or a hosted service such as Redis Cloud or Upstash |

> **Important:** the server checks Redis when it starts and **exits if it cannot reach it**, even if you only want to look at existing data. Make sure Redis is running before you start the API.

---

## 6. Installation and setup

### Step 1: Get the code

```bash
git clone https://github.com/JRamraju/sales_Dashboard.git
cd sales_Dashboard
```

### Step 2: Start MongoDB and Redis

If you do not already have them, the quickest way is Docker:

```bash
docker run -d --name sales-mongo -p 27017:27017 mongo:7
docker run -d --name sales-redis -p 6379:6379 redis:7
```

To stop and remove them later: `docker rm -f sales-mongo sales-redis`.

If you use MongoDB Atlas or a hosted Redis, skip this step and put their connection strings into `server/.env` in the next step.

### Step 3: Set up the server

```bash
cd server
npm install
cp .env.example .env
```

Open `server/.env`. For a local setup with the Docker containers above you do not need to change anything. The defaults are:

```
MONGODB_URI=mongodb://127.0.0.1:27017/sales_dashboard
REDIS_URL=redis://127.0.0.1:6379
PORT=5000
CLIENT_ORIGIN=http://localhost:3000
```

Start the API in development mode:

```bash
npm run dev
```

A healthy start prints lines similar to:

```
[mongo] connected: 127.0.0.1/sales_dashboard
[redis] connected
[worker] running inside the API process
[server] listening on http://localhost:5000  (API: /api/v1)
```

Verify it:

```bash
curl http://localhost:5000/health
curl http://localhost:5000/health/ready
```

### Step 4: Set up the client

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

The dashboard is now at **http://localhost:3000**.

The client expects the API at `http://localhost:5000` by default. If your API is elsewhere, create `client/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```

Restart `npm run dev` after changing environment files.

### Step 5: Load your first dataset

1. Open http://localhost:3000. With an empty database you will see a welcome panel with an upload area.
2. Drop in `sample-data/MOCK_DATA(1).csv` (or click the area to browse).
3. Click the upload button and watch the progress bar.
4. When processing finishes the dashboard loads the new dataset automatically.

---

## 7. Configuration reference

### Server (`server/.env`)

Only `MONGODB_URI` is required. Everything else has a default.

**Core**

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | none (required) | MongoDB connection string |
| `PORT` | `5000` | HTTP and WebSocket port |
| `NODE_ENV` | `development` | In `production`, unexpected 500 errors return a generic message and no stack trace |
| `CLIENT_ORIGIN` | `http://localhost:3000` | Comma-separated list of browser origins allowed by CORS and Socket.io |
| `TRUST_PROXY` | unset | Number of reverse-proxy hops in front of the API (usually `1`). Needed so rate limiting sees real client IPs |

**Rate limiting**

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_MAX` | `1500` | Requests per IP per 15 minutes across `/api` |
| `UPLOAD_RATE_LIMIT_MAX` | `30` | Uploads per IP per 15 minutes |

**Redis and background processing**

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL. Use `rediss://` for TLS |
| `RUN_WORKER_IN_API` | `true` | Run the upload worker inside the API process. Set `false` and run `npm run worker` separately for large files |
| `WORKER_CONCURRENCY` | `1` | Number of upload jobs processed at the same time |
| `ENQUEUE_TIMEOUT_MS` | `5000` | How long `POST /uploads` waits for Redis before answering 503 |
| `REDIS_KEEPALIVE_MS` | `10000` | TCP keep-alive interval. Helps hosted Redis over home or office networks |
| `WORKER_LOCK_MS` | `120000` | How long a running job may lose contact with Redis before BullMQ re-runs it |
| `SOCKET_ROOMS` | `false` | When `true`, progress events go only to browsers that joined the batch room |

**Uploads**

| Variable | Default | Description |
|---|---|---|
| `MAX_UPLOAD_MB` | `50` | Maximum accepted file size |
| `UPLOAD_DIR` | OS temp folder + `/sales-uploads` | Where uploaded files wait for the worker. Must be shared if the worker runs on another machine |
| `MAX_ERROR_LOGS` | `1000` | Skipped-row messages stored per upload. The true skipped count is always kept |
| `DEFAULT_DATE_ORDER` | `dmy` | How to read `a/b/YYYY` dates when the file does not prove the order. `dmy` or `mdy` |
| `STALE_UPLOAD_MINUTES` | `60` | A queued or processing upload older than this may be deleted anyway |

**MongoDB**

| Variable | Default | Description |
|---|---|---|
| `MONGODB_MAX_POOL_SIZE` | `20` | Connection pool size |
| `SYNC_INDEXES` | `false` | Set `true` for one start-up on an existing database to create missing indexes and drop old ones the schema no longer declares |

**Caching**

| Variable | Default | Description |
|---|---|---|
| `CACHE_TTL_SECONDS` | `120` | How long finished datasets' analytics responses are reused. `0` disables caching |
| `CACHE_MAX_ENTRIES` | `500` | Maximum number of cached responses |

### Client (`client/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:5000/api/v1` | REST API base URL |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:5000` | Socket.io server URL |

Next.js bakes `NEXT_PUBLIC_*` values into the browser bundle at **build time**. If you change them for production, rebuild the client.

---

## 8. Running the project

### Development

Two terminals:

```bash
# terminal 1
cd server && npm run dev        # API (with auto-restart) on :5000

# terminal 2
cd client && npm run dev        # dashboard on :3000
```

### Production-style run

```bash
# server
cd server
npm install --omit=dev
NODE_ENV=production npm start

# client
cd client
npm install
npm run build
npm start
```

### Separate worker (recommended for files with 100,000+ rows)

By default the worker runs inside the API process, which is convenient but means heavy ingestion shares a process with request handling. To split them:

```bash
# server/.env
RUN_WORKER_IN_API=false
```

```bash
# terminal A
cd server && npm start           # API only

# terminal B
cd server && npm run worker      # standalone worker
```

Both processes need the same `.env`, the same MongoDB and Redis, and access to the same `UPLOAD_DIR` folder, because the API saves the uploaded file to disk and the worker reads it from there.

---

## 9. Using the dashboard

**Layout.** A fixed sidebar on the left links to each section (KPI Overview, Revenue Trends, Sales Forecast, Category & Region, Products & Customers). A sticky bar at the top holds the dataset selector, the upload button and the filters.

**Uploading a file**

1. Click the upload button in the top bar (or use the welcome panel on first run).
2. Drop a `.csv` or `.xlsx` file. The upload area rejects other types and files over 50 MB.
3. Click upload. The progress bar moves through two stages: sending the file, then processing on the server (row counts update as the worker advances).
4. On completion the new dataset is selected and filters are reset.

**Data health banner.** After an upload, a banner shows how many rows were inserted and how many were skipped. If any rows were skipped, **View Skipped Rows** opens a list showing the row number, column and reason for each. From there you can download the whole report as `quarantine_report_<filename>.csv`. The banner can be dismissed. A reminder also appears whenever you select an existing dataset that has skipped rows.

**Filtering.** Use the top bar to set a start date, an end date, one or more categories and one or more regions. The date pickers are bounded by the dataset's first and last order dates. Every card, chart and table updates. Changing a filter cancels any request still in flight, so you never see out-of-date numbers.

**Dashboard sections**

| Section | What it shows |
|---|---|
| KPI cards | Total Revenue, Total Orders (distinct order IDs), Total Customers (distinct customer IDs), Average Order Value (revenue divided by orders), Revenue Growth |
| Revenue trend | Revenue over time. Choose Daily, Weekly or Monthly |
| Sales forecast | Historical monthly revenue (solid) and projected revenue (dashed) with a confidence badge showing the R-squared of the trend line. Honors category and region filters but not date filters |
| Category / Region | Donut chart of revenue share. Switch between Category and Region |
| Top 10 products | Products ranked by revenue, with units sold and share of sales. Switch between split (chart and table), chart-only and table-only views |
| Customer leaderboard | Top customers with total orders, total spend, average order value and last purchase date. Search by name, sort by any column, 6 rows per page |

**Revenue Growth explained.** If you set both a start and an end date, growth compares that period with the immediately preceding period of the same length. Otherwise it compares the most recent month in the data with the month before it.

**Switching and deleting datasets.** Use the dataset dropdown in the top bar to switch. The delete button next to it removes the selected dataset and all its sales records after a confirmation prompt. A dataset that is still processing cannot be deleted until it finishes (or until it has been stuck longer than `STALE_UPLOAD_MINUTES`).

---

## 10. Input file format

Supported: `.csv` (UTF-8) and `.xlsx`. For Excel, the **first sheet** is read and the first row must contain headers. `.xls` (old Excel format) is not supported by the server; re-save as `.xlsx`.

### Columns

| Column | Required | Notes |
|---|---|---|
| `order_id` | Yes | Rows sharing the same `order_id` are lines of one order |
| `order_date` | Yes | See date rules below |
| `customer_id` | Yes | |
| `quantity` | Yes | Positive whole number |
| `product_id` or `product_name` | At least one | If only one is given, it is copied to the other |
| `unit_price` or `total_amount` | At least one | If `total_amount` is missing it is calculated as `quantity x unit_price - discount`. If `unit_price` is missing it is derived as `(total_amount + discount) / quantity` |
| `customer_name` | No | Defaults to the customer ID |
| `category` | No | Defaults to `Uncategorized` |
| `region` | No | Defaults to `Unknown` |
| `discount` | No | An **amount** per line (not a percentage). Defaults to 0 |

### Header aliases

Header matching ignores case, spaces, underscores, dashes and punctuation (`Unit Price`, `unit_price` and `UnitPrice` are the same). Recognised aliases:

| Field | Also accepted |
|---|---|
| order_id | order number, order no, order num, invoice id, invoice no |
| order_date | date, sale date, purchase date, transaction date, order date time |
| customer_id | cust id, customer code, client id |
| customer_name | customer, client, client name, buyer, buyer name |
| product_id | sku, sku id, product code, item id |
| product_name | product, item, item name |
| category | product category, category name |
| region | area, zone, territory |
| quantity | qty, units, units sold, quantity sold |
| unit_price | price, price per unit, rate, selling price |
| discount | discount amount, disc |
| total_amount | total, amount, total revenue, revenue, line total, net revenue, total price |

If two columns in a file map to the same field (for example both `Total` and `Amount`), the first one wins and the other is ignored. Unknown columns are ignored.

### Dates

Accepted formats: Excel date cells, Excel serial numbers, ISO strings (`2025-05-26T10:30:00Z`), `YYYY-MM-DD` (also with `/` or `.`), and `a/b/YYYY` (also with `-` or `.`). The year must be between 1900 and 2100 and the date must exist (31 February is rejected).

For `a/b/YYYY` dates the server decides **per file** whether they are day-first or month-first by scanning the first 2,000 rows:

- A date whose first number is above 12 (for example `26/05/2025`) proves day-first.
- A date whose second number is above 12 (for example `5/26/2025`) proves month-first.
- If the file has no such evidence, `DEFAULT_DATE_ORDER` decides (default day-first).
- If a file mixes both, the majority wins and the minority rows are reported as skipped.

The chosen order is stored with the upload and shown as a note.

### Numbers

Money and quantity cells may contain `$`, `₹`, `€`, `£`, thousands separators and spaces. `₹1,299.50` is read as `1299.5`. Negative prices, discounts and totals are rejected.

### Rows that are skipped (quarantined)

A row is skipped, never inserted, and listed in the quarantine report when:

- `order_id` or `customer_id` is missing
- `order_date` is missing or cannot be parsed
- `quantity` is missing, zero, negative or not a whole number
- both `product_id` and `product_name` are missing
- both `unit_price` and `total_amount` are missing
- a price, discount or total is not a number or is negative
- the discount is larger than the line total

Completely blank rows are ignored silently and are not counted as skipped.

### Whole-file rejections

The upload fails immediately (before any row is processed) when the file is empty, is not really a CSV or XLSX (the server checks the file's contents, not just its name), or lacks a required column.

---

## 11. Sample data

The `sample-data` folder contains `MOCK_DATA(1).csv` and `MOCK_DATA(1).xlsx` with 1,000 order lines each. The columns are:

```
order_id, order_date, customer_id, customer_name, product_id, product_name,
category, region, quantity, unit_price, discount, total_amount
```

A sample row:

```
ORD-10299,5/26/2025,CUST-836,Customer Corp 836,PROD-402,Ergonomic Chair,Furniture,West,12,6873.04,217.91,82258.57
```

Dates use `M/D/YYYY`; the server detects this automatically because some dates (like `5/26/2025`) prove month-first.

---

## 12. Available scripts

**Server** (`cd server`)

| Command | Description |
|---|---|
| `npm run dev` | Start the API with automatic restart on file changes |
| `npm start` | Start the API |
| `npm run worker` | Start a standalone upload worker |
| `npm run dev:worker` | Standalone worker with automatic restart |
| `npm test` | Run all tests with Node's test runner |

**Client** (`cd client`)

| Command | Description |
|---|---|
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |

---

## 13. Testing

```bash
cd server
npm test
```

The suite uses Node's built-in test runner. It does not need MongoDB or Redis because the logic under test is written as pure functions.

| Test file | What it checks |
|---|---|
| `cache.test.js` | Cache hits, request coalescing, expiry, invalidation during an in-flight load, least-recently-used eviction, failed loads not cached, TTL of 0 disables caching |
| `dateOrder.test.js` | Day-first and month-first detection, fallback behavior, majority rule, rejection of impossible dates, ISO, Date-object and Excel-serial parsing |
| `fileParser.test.js` | Semicolon CSV with BOM and blank lines (real row numbers kept), quoted commas, header aliasing, file-level errors raised early, async-iterable row interface |
| `forecast.test.js` | No history, fewer than 3 months, perfect linear fit, constant history, widening prediction range, no negative forecasts, horizon clamping, gap filling |
| `kpi.test.js` | Match-stage construction, previous-period window, both growth modes, trend gap filling, breakdown shaping |
| `mappers.test.js` | Error-log mapping, batch mapping, WebSocket snapshot replay for each status |
| `redisStatus.test.js` | Password redaction in logs, connection-error detection, outage log throttling and recovery messages |
| `validator.test.js` | Defaults, computed totals, derived unit price, currency stripping, error messages naming the column, date-order option, fractional or zero quantity |

There are no automated client tests yet. Run `npm run lint` in `client` for static checks.

---

## 14. Deployment notes

- **Two services plus two data stores.** Deploy the API (optionally with a separate worker process), the Next.js client, MongoDB and Redis.
- **CORS.** Set `CLIENT_ORIGIN` on the API to the exact public URL(s) of the client (comma-separated). The same list protects Socket.io.
- **Client build variables.** Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` *before* `npm run build`.
- **Reverse proxy.** Set `TRUST_PROXY=1` (or the right number of hops) so rate limiting works per user. Make sure the proxy forwards WebSocket upgrades to the API.
- **Hosted Redis.** Use a `rediss://` URL if TLS is required. Keep `REDIS_KEEPALIVE_MS` set so idle connections are not silently dropped.
- **Shared upload folder.** If the worker runs on a different machine or container from the API, `UPLOAD_DIR` must point to storage both can read and write.
- **Health checks.** Use `GET /health` for liveness and `GET /health/ready` for readiness. Readiness depends only on MongoDB.
- **Existing databases.** After upgrading from an older schema, start once with `SYNC_INDEXES=true`, then turn it off again.
- **Security.** The application has no authentication. Do not expose it publicly without adding it (see [Known limitations](#16-known-limitations)).

---

## 15. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Server exits at start with `Redis not reachable at ...` | Redis is not running or `REDIS_URL` is wrong. The server fails fast by design |
| `MONGODB_URI is not set` | You did not copy `.env.example` to `.env`, or the variable is empty |
| `[mongo] connection error` / `MongoServerSelectionError` | MongoDB is not reachable. Check the URI, network access and Atlas IP allow-list |
| Repeated `connect ETIMEDOUT` from Redis | Network or provider dropped an idle connection. Keep `REDIS_KEEPALIVE_MS` set and use `rediss://` for TLS providers |
| Upload returns 503 "upload queue is unavailable" | The API could not reach Redis within `ENQUEUE_TIMEOUT_MS` |
| Upload returns 400 "Only .csv and .xlsx files are supported" | Wrong file type. Old `.xls` files must be re-saved as `.xlsx` |
| Upload returns 400 "not a UTF-8 CSV" | The file contains binary data or is really an Excel file with a `.csv` name. Re-save as "CSV UTF-8" or upload as `.xlsx` |
| Upload returns 413 | The file is larger than `MAX_UPLOAD_MB` |
| 429 "Too many requests" | Raise `RATE_LIMIT_MAX` or `UPLOAD_RATE_LIMIT_MAX`, or set `TRUST_PROXY` if you are behind a proxy |
| Browser console shows a CORS error | Add the client's exact origin to `CLIENT_ORIGIN` and restart the API |
| Dashboard says "Unable to reach the analytics server" | The API is not running on the expected port, or `NEXT_PUBLIC_API_URL` is wrong (rebuild after changing it) |
| Progress bar stays at the "processing" stage | Check the API/worker logs. If you set `RUN_WORKER_IN_API=false`, make sure `npm run worker` is running |
| Dates are interpreted the wrong way round | The file has no date that proves its order. Set `DEFAULT_DATE_ORDER=mdy` (or `dmy`) |
| Many rows skipped | Open **View Skipped Rows**: each entry names the row, column and reason |
| Cannot delete a dataset (409) | It is still queued or processing. Wait, or wait `STALE_UPLOAD_MINUTES` if the job is stuck |
| Rate limit hits everyone at once behind a proxy | Set `TRUST_PROXY=1` |
| Old indexes remain after an upgrade | Start once with `SYNC_INDEXES=true` |
| Port already in use | Change `PORT` (server) or run `npm run dev -- -p 3001` (client) and update `CLIENT_ORIGIN` accordingly |

---

## 16. Known limitations

- **No authentication or multi-user separation.** Anyone who can reach the app can see, upload and delete every dataset.
- **`.xls` mismatch.** The upload area accepts `.xls`, but the server only accepts `.csv` and `.xlsx`.
- **Excel memory use.** Excel files are loaded fully into memory (CSV files are streamed).
- **Forecast scope.** The forecast is a simple, explainable trend model. It does not model seasonality or promotions, and with only 3 to 4 months of history its range is very wide.
- **Per-process cache.** The response cache lives in the API process; multiple API instances each have their own.
- **Single sheet.** Only the first sheet of an Excel workbook is read.
- **No client automated tests and no CI or Docker files** are included yet.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete list with suggested improvements.
