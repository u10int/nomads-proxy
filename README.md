# nomads-cors-proxy

A minimal Express proxy that forwards `HEAD` requests to
[nomads.ncep.noaa.gov](https://nomads.ncep.noaa.gov) for browser clients
blocked by CORS. Designed to run on DigitalOcean App Platform.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check — returns `{ status: "ok" }` |
| `GET /proxy?url=<nomads-url>` | Checks availability of a NOMADS directory |

### Proxy response

```json
{
  "available": true,
  "url": "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20260422/00/atmos/",
  "statusCode": 200,
  "lastModified": "Wed, 22 Apr 2026 04:41:00 GMT"
}
```

## Deploy to DigitalOcean App Platform

### Prerequisites

- [doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/) installed and authenticated
- A GitHub account

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create nomads-cors-proxy --public --push --source=.
# or: git remote add origin https://github.com/YOUR_USERNAME/nomads-cors-proxy.git
#     git push -u origin main
```

### Step 2 — Edit the app spec

Open `.do/app.yaml` and replace:

```yaml
repo: YOUR_GITHUB_USERNAME/nomads-cors-proxy
```

with your actual GitHub username.

Optionally change `region` to one closer to you:
`nyc` `sfo` `ams` `lon` `fra` `sgp` `tor` `blr` `syd`

### Step 3 — Deploy with doctl

```bash
doctl apps create --spec .do/app.yaml
```

That's it. App Platform will:
1. Pull your repo
2. Build the Docker image
3. Deploy and give you a public HTTPS URL like:
   `https://nomads-cors-proxy-xxxx.ondigitalocean.app`

### Step 4 — Update your dashboard HTML

In `weather-model-status.html`, change:

```js
const PROXY_BASE = "http://localhost:3000";
```

to:

```js
const PROXY_BASE = "https://nomads-cors-proxy-xxxx.ondigitalocean.app";
```

### Step 5 — Lock down CORS (recommended)

Once you know your frontend's URL, update `ALLOWED_ORIGINS` in `.do/app.yaml`:

```yaml
- key: ALLOWED_ORIGINS
  value: "https://yourapp.com"
```

Then redeploy:

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on (App Platform sets this automatically) |
| `NOMADS_ALLOWED_HOST` | `nomads.ncep.noaa.gov` | Only this host can be proxied |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins (comma-separated) |
| `PROXY_API_KEY` | _(unset)_ | If set, require `X-API-Key` header on all requests |
| `REQUEST_TIMEOUT_MS` | `15000` | Upstream request timeout in ms |

## Local dev

```bash
npm install
node server.js
# or
npm run dev   # uses node --watch for auto-restart
```
