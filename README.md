# Manna_CMMS
Maintenance Management System for Manna Group of Companies

## Where it runs

| Part | Host | Address |
|---|---|---|
| Web client (`client/`) | Cloudflare Pages project `mannagroupcmms` on **it@mannarubber.com's Account**, Git-connected to this repository: push to `main` and it redeploys | `https://mannagroupcmms.pages.dev` |
| API (`server/`) | Render | `https://manna-cmms.onrender.com` |
| SAP sync (`sap-sync/`) | The SAP server, `C:\Users\eldhose\sap-engineering-sync\` | - |

Between 17 and 20 October 2026, while the Cloudflare account was out of reach, the client was also deployed
from GitHub Actions to `manna-cmms.pages.dev` on the Manna Group account. That was undone once access came
back, and `manna-cmms.pages.dev` was taken out of the API's CORS list so a project of that name created by
anybody else later cannot call the API. If the account is ever lost again, the reverted commit (`e61fa26`) is
the recipe.
