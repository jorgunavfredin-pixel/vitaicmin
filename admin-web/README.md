# Web Admin Panel

Panel admin berbasis web untuk bot toko. Berjalan di server Express yang sama
dengan bot (port 3000), memakai database SQLite yang sama.

- **UI:** React + Vite (SPA), tema dark modern
- **API:** `/api/admin/*` (Express, di `src/web/`)
- **Auth:** password admin + JWT

## Konfigurasi `.env` (di root project)

```
ADMIN_PANEL_PASSWORD=passwordkuat123     # wajib untuk login panel
ADMIN_JWT_SECRET=random-string-panjang   # opsional (default: pakai BOT_TOKEN)
```

## Development

```bash
# Terminal 1 — jalankan bot + API
npm start

# Terminal 2 — dev server SPA (hot reload, proxy /api ke :3000)
cd admin-web
npm install
npm run dev
# buka http://localhost:5173/admin/
```

## Production (build sekali, diserve oleh bot)

```bash
cd admin-web
npm install
npm run build        # hasil ke admin-web/dist
```

Setelah di-build, panel bisa diakses di: `http://IP_SERVER:3000/admin`

> Docker: build frontend sudah otomatis di `Dockerfile` (multi-stage).
