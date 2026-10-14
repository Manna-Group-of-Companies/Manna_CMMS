# Push notifications for the Maintenance Manager's phone

The phone rings the moment a plant reports a breakdown or raises a maintenance
request - app closed, phone locked - the way the Play Store apps do. It runs
through Firebase Cloud Messaging (FCM), Google's push service, which keeps one
connection to every Android phone and wakes the app through it.

Without it the phone still gets the same notifications, by polling: every 20
seconds with the app open, about every 15 minutes with it closed.

## How it works

1. The app signs in as a Maintenance Manager and sends its Firebase token to
   `PUT /api/devices`. The server keeps it in ERPNext as a `CMMS Device` row
   (`server/scripts/syncDevices.js` creates that DocType once).
2. A plant reports a breakdown or raises a request through the server
   (`POST /api/breakdowns`, `POST /api/maintenance-requests`). After answering,
   the server sends one high-priority data message to every Maintenance
   Manager phone (`server/integrations/push.js`).
3. The phone draws the notification itself (`mobile/lib/core/push_messages.dart`)
   on the same channels, with the same tap-to-open, as the polled ones, and
   through the same ledger - so the poll and the push never ring twice for one
   record.
4. On sign-out the phone withdraws its token (`DELETE /api/devices/:token`).
   A token Firebase reports dead is dropped by the server.

A record created straight in ERPNext, bypassing the server, is not pushed; the
polling catches it.

## Setting it up (once)

You need a Google account. Everything below is free at this scale.

### 1. The Firebase project

1. Open <https://console.firebase.google.com> and **Add project** - call it
   `Manna CMMS`. Google Analytics can be left off.
2. In the project, **Add app** → **Android**. The package name must be exactly
   `com.mannarubber.stockmaster`. Nickname and SHA-1 can be left empty.
3. Download **`google-services.json`** and put it at
   `mobile/android/app/google-services.json`. It is git-ignored; keep a copy
   somewhere safe, since every machine that builds the app needs it.

### 2. The server's key

1. In the Firebase project: **Project settings** (gear) → **Service accounts**
   → **Generate new private key**. A JSON file downloads. It is a secret: not
   in git, not in the app.
2. Give it to the server as an environment variable. On Render (and most
   dashboards, which take single-line values) base64 the file first:

       base64 -w0 service-account.json

   and set `FIREBASE_SERVICE_ACCOUNT` to that string. Locally,
   `FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json` in
   `server/.env` works too. See `server/.env.example`.
3. Restart the server. The log says `Push notifications on (Firebase project
   …)` - or why they are off.

### 3. The ERPNext table

Once, from `server/`:

    node scripts/syncDevices.js

### 4. Rebuild the app

With `google-services.json` in place, build and install the app. On first
sign-in as the Maintenance Manager it registers; the row appears under
**CMMS Device** in ERPNext within a few seconds.

## Checking it

Report a breakdown from a plant manager account with the Maintenance
Manager's phone locked. It should ring within a few seconds. The server log
shows `Breakdown BD-…: pushed to 1 phone(s)`.

If the phone does not ring:

- **Server log says push is off** - the service account is not set, or the
  JSON is wrong.
- **`not pushed, no phones registered`** - the phone has not registered.
  Check the app's log for `Push notifications are off` (no
  `google-services.json` in that build) or `Could not register this phone`.
- **Pushed, but silent** - the phone's notification permission, or Samsung's
  battery setting for the app (**Unrestricted** is safest).
