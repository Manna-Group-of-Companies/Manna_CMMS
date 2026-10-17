# Deploying the web client

| Part | Where | How it deploys |
|---|---|---|
| `client/` | Cloudflare Pages, Manna Group account, `https://manna-cmms.pages.dev` | `.github/workflows/deploy-client.yml` on every push to `main` that touches `client/` |
| `server/` | Render, `https://manna-cmms.onrender.com` | Render, unchanged |

The client is static. It calls the API cross-origin with a bearer token, so
it needs no proxy and no Pages Functions. The API address is baked into the
bundle from `client/.env.production`.

## Why GitHub Actions and not Cloudflare's Git integration

This repository is already connected to Cloudflare from two other accounts:
the Pages project `mannagroupcmms` (which served the client until this was
set up) and a Worker, `mannarpplcmms`. Cloudflare lets a repository feed Pages
on only one account, so the Manna Group account deploys by Direct Upload
instead.

Those two keep building on every push until somebody with access to their
accounts disconnects them. Nothing here depends on them.

There is deliberately no `client/wrangler.toml`. The `mannarpplcmms` Worker
runs `wrangler deploy`, which would read a Pages config and fail.

## The one secret

The workflow needs `CLOUDFLARE_API_TOKEN` in this repository's Actions secrets.
A secret added to `SALES_DASHBOARD` is not visible here.

1. Cloudflare dashboard → profile icon → **My Profile → API Tokens**. Reuse the
   token made for the sales dashboard if you still have it, or **Create Token →
   Create Custom Token** with **Account · Cloudflare Pages · Edit**, limited to
   **Manna Group**.
2. GitHub → this repository → **Settings → Secrets and variables → Actions →
   New repository secret**. Name `CLOUDFLARE_API_TOKEN`, paste the token.

## CORS

`server/index.js` allows both `mannagroupcmms.pages.dev` and
`manna-cmms.pages.dev`, plus their preview subdomains. The server has to be
redeployed on Render with that change before the new address can sign in.
Remove the old origin once nobody uses the old address.
