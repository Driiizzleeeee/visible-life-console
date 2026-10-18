# Visible Life Console — development

## Run the current MVP

Double-click `start-visible-life-console.cmd`. It opens the pre-built app in your browser.
Keep the terminal window open while using the dashboard; close it to stop the
local server.

## Start locally

Requirements: Node.js 20 or newer.

On Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local address printed by Vite (normally `http://localhost:5173`).

## Build

```powershell
npm.cmd run build
npm.cmd run preview
```

## Data

The MVP stores all data in the browser under the `visible-life-console-v1`
localStorage key. Existing data from the legacy `visible-dashboard-v1` key is read automatically,
and version 1 through 9 browser data is migrated to version 10.
Use **Manage → Export JSON** for a complete backup and
**Import JSON** to restore it. CSV export contains Daily Log entries only.

There is intentionally no account, cloud sync, backend, AI scoring, or inventory
module in this version. A later phase can replace `src/storage.ts` with a Spring
Boot REST API without changing the dashboard's domain model.
