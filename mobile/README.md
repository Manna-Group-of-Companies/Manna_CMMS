# StockMaster — Flutter client

Flutter port of the **supervisor portal** from the React (`client/`) front end.
It talks to the same Express + MongoDB API in `server/`; **no backend changes
were needed**.

The admin console is web-only. Admin accounts are refused at login here, and
`/admin/*` routes no longer exist — use `client/` for approvals and the admin
dashboard.

Runs on Android, iOS, Windows and web from one codebase.

## Running it

1. Start the API:

   ```bash
   cd server
   npm install
   npm run dev          # listens on :5000
   ```

2. Start the app:

   ```bash
   cd mobile
   flutter pub get
   flutter run
   ```

### Pointing at the API

The app finds the server itself — see
[`lib/core/server_config.dart`](lib/core/server_config.dart). On start-up it
takes the first address that answers `GET /api/health`:

1. `--dart-define=API_URL=…` — a compile-time pin, wins outright
2. the address saved in the app (from the **Server address** sheet)
3. `--dart-define=API_HOST=…`, then `10.0.2.2` (Android emulator),
   `localhost`, `127.0.0.1`
4. a sweep of the device's own Wi-Fi subnet for port 5000, run automatically
   when everything above fails

The login screen shows the current address at the bottom; tapping it opens a
sheet to type one in or re-run auto-detection. Nothing is shown while the
server is reachable.

To skip discovery entirely:

```bash
flutter run --dart-define=API_URL=http://192.168.1.10:5000/api
# or just the host, with the port and /api filled in for you
flutter run --dart-define=API_HOST=192.168.1.10
```

#### On a physical phone

`localhost` and `10.0.2.2` do **not** reach your computer from a real device —
that combination is what produced "The server took too long to respond". Two
things have to be true:

- the phone and the computer are on the **same Wi-Fi** network, and
- the computer's firewall allows inbound TCP on port 5000.

  On Windows, `npm run dev` may run under
  `server/node_modules/node/bin/node.exe` rather than the system Node, so an
  existing "Node.js" firewall allowance will not apply to it. Grant the port
  (elevated PowerShell):

  ```powershell
  New-NetFirewallRule -DisplayName "StockMaster API 5000" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 `
    -Profile Private,Public
  ```

Plain-http access is enabled for development via `usesCleartextTraffic`
(Android) and `NSAllowsLocalNetworking` (iOS). Remove both once the API is
served over https.

### Demo account

Seeded by `server/utils/seeder.js`; the login screen has a one-tap shortcut.

| Role       | Email                    | Password         |
| ---------- | ------------------------ | ---------------- |
| Supervisor | `supervisor@stock.com`   | `Supervisor@123` |

The seeded admin (`admin@stock.com`) is rejected with "Admin accounts use the
web console."

## Checks

```bash
flutter analyze     # clean
flutter test        # 32 tests
```

## How it maps to the React app

| React                                | Flutter                                          |
| ------------------------------------ | ------------------------------------------------ |
| `services/api.js` (axios + interceptors) | `core/api_client.dart` + `data/repository.dart` |
| `context/AuthContext.jsx`            | `state/auth_provider.dart`                        |
| `context/NotificationContext.jsx`    | `state/notification_provider.dart`, `core/toast.dart` |
| `App.jsx` routes + layout guards     | `router.dart` (go_router; supervisor routes only)  |
| `components/Sidebar.jsx`             | `widgets/app_shell.dart` → `AppDrawer`            |
| `components/Navbar.jsx`              | `widgets/app_shell.dart` → app bar + bell sheet   |
| `pages/auth/Login.jsx`               | `screens/login_screen.dart`                       |
| `pages/admin/*.jsx`                  | — not ported; web console only                    |
| `pages/supervisor/*.jsx`             | `screens/supervisor/*.dart`                       |
| Tailwind slate/purple theme, `.glass-premium` | `core/palette.dart`, `core/theme.dart`, `widgets/common.dart` |

`localStorage` → `shared_preferences`; React context → `provider`;
`react-router-dom` → `go_router`.

## Deliberate differences

Everything the web client does is present. These changes were made because a
phone is not a desktop browser, or because the web version had a gap:

- **Wide tables → cards.** Every table (products, requests, issues) is a list
  of cards; modals are bottom sheets, and the sidebar is a drawer.
- **Stock In / Out / Return requests are reachable.** The web client has
  complete handlers and a modal for these, but no button opens it — supervisors
  cannot raise the requests the admin console is built to approve. They are in
  the product card's overflow menu here.
- **Product details are always complete.** `/issues` populates only a few
  product fields, so the web spec sheet renders blanks. The sheet re-fetches the
  full product by id when it detects a partial record.
- **Two missing page titles filled in.** The web `getPageTitle()` had no case
  for admin `/products` or supervisor `/issues` and fell through to a generic
  label.
- **Search is debounced** by 350 ms instead of firing a request per keystroke.
- Pull-to-refresh on every list; login has a password reveal toggle.
