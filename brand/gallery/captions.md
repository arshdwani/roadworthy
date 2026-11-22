# Devpost gallery (1920×1280) — in story order

1. `1-board.png` — The Fleet compliance board after a live scan: NHTSA matched 28 recalls, 16 need action, 12 were ruled out with reasons, and Park It vehicles are grounded at once.
2. `2-ruled-out.png` — Per-vehicle verdicts: a recall for 8-inch screens is ruled out on F-150s with 12-inch screens, a 2.5L engine recall on a 2.0L van, an AWD recall on rear-drive vans, a converter's recall on factory vans.
3. `3-request.png` — Each JSM request shows the recall, why it applies to this vehicle, and the steps: schedule the dealer, then record the repair order.
4. `4-assets.png` — Vehicles live in JSM Assets; Roadworthy keeps each vehicle's status in step with its recalls (Park It – do not drive, Do not rent, Available).
5. `5-architecture.png` — How it's built: a Forge app in Jira, with JSM Assets, NHTSA vPIC and recalls, per-vehicle verdicts and one request per campaign × vehicle. Only VINs and make/model/year leave the site.
