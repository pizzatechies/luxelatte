# Luxe Latte

Website and online ordering for **Luxe Latte**, a coffee and juice joint, with a "coming soon" page for the burgers & fries eatery.

- **Menu & ordering.** Coffee (Cappuccino, Latte, Mocha, Long Black, Espresso) and the eight Luxe juices. Tap a price to add a drink, then check out.
- **M-Pesa Paybill payments.** Customers pay to Paybill **714777**, Account **0112542203**, and enter their M-Pesa confirmation code. They can also choose to pay at the counter.
- **Live order tracking.** Each order gets a tracking page (`/order/…`) that updates on its own: Received → Preparing → Ready → Collected. Customers can also look an order up at `/track`.
- **Staff dashboard** at `/admin`. New / Preparing / Ready columns, a sound and pop-up alert for new orders, payment confirmation, a "taking orders" on/off switch, sold-out toggles, and today's totals.
- **Burgers & Fries: coming soon** at `/eatery`, with a "notify me" waitlist you can download as a CSV from the dashboard.

## Run it

Requires **Node.js 22.13 or newer** (it uses the SQLite that ships with Node, so there's no database to install).

```bash
npm install
```

```bash
cp .env.example .env   # then set ADMIN_PASSWORD and SESSION_SECRET
```

```bash
npm start
```

Open http://localhost:3000. The dashboard is at http://localhost:3000/admin. If `ADMIN_PASSWORD` isn't set, a temporary password is printed in the terminal.

Run the tests with `npm test`.

## Editing the menu, prices and details

| What | Where |
| --- | --- |
| Drinks, descriptions, sizes, prices, colours | `data/menu.json` |
| Paybill/account, pickup/dine-in/delivery options, delivery fee, phone, WhatsApp, Instagram, address, opening hours | `data/site.json` |
| Logo files | `public/img/logo*.png` |
| Page text | `views/*.html` |

A category can set `"deliverySurcharge"` in `menu.json` (juices are +50 each when delivered); `deliveryFee` in `site.json` adds a flat fee on top (currently 0).

Restart the server after editing these files. Contact details and hours stay hidden until you fill them in. Hours format: `"hours": [{ "days": "Mon – Sat", "time": "7am – 8pm" }]`.

Marking an item as sold out or pausing online orders is done in the dashboard and takes effect straight away.

## How payment confirmation works

The Paybill and account belong to your bank/M-Pesa setup, so the site can't see payments by itself. Instead:

1. The customer pays via Lipa na M-Pesa → Pay Bill and pastes the confirmation code on their order page.
2. The order shows **"To verify"** on the dashboard with the code and amount.
3. Check the M-Pesa message on your phone and click **Confirm paid**.

If you later get your own M-Pesa shortcode with Daraja API access, the order flow can be extended to send an STK push automatically.

## Deploying

Any host that runs Node works (Render, Railway, Fly.io, a VPS). Set these environment variables:

- `ADMIN_PASSWORD`: dashboard password
- `SESSION_SECRET`: long random string
- `STORAGE_DIR`: a **persistent** disk or volume, which is where orders are stored (`luxelatte.db`)
- `TRUST_PROXY=1`: when running behind the host's proxy or HTTPS
- `NODE_ENV=production`

A `Dockerfile` is included. On free tiers without a persistent disk, orders are wiped whenever the server restarts, so attach a volume.

## Project layout

```
server.js          entry point
src/               app (routes), database, validation, security
data/              menu.json, site.json  ← edit these
views/             HTML pages + partials (header, footer)
public/            css, js, images
test/              API tests (node --test)
```
