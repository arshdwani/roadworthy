# Marketplace listing copy (Roadworthy)

**App name:** Roadworthy: Fleet Recall Compliance
**Product:** Jira (Jira Service Management). Single product, free.
**Category ideas:** IT & helpdesk / Asset management / Workflow

## Persona
Maria, compliance lead for a 300-vehicle rental fleet: "NHTSA matched 27 recalls to my cars. Roadworthy told me 15
need the dealer, ruled out 12 with the reason for each, and kept the Park It ones off the lot."

## Tagline (≤ 90 characters)
Find the vehicles that really need a recall repair, ground them, and prove the fix in JSM.

## Summary (≤ 250 characters)
Roadworthy checks every vehicle in JSM Assets against live NHTSA safety recalls each day, rules recalls in or out
per VIN with reasons, opens one JSM request per real match, and grounds "Park It" vehicles until the repair is proven.

## Highlights (3)
1. **Per-vehicle verdicts, not model-wide noise.** NHTSA lists recalls by make, model and year. Roadworthy reads each
   recall's scope (engine, fuel, drive, equipment, converter, earlier repairs) against the VIN decode and says
   "Likely", "Possibly" or "Unlikely" affected, with the reason: "Recall covers 2.5L hybrid engines; this VIN decodes
   to 2.0L EcoBoost".
2. **Park It means parked.** "Park It" and "Park Outside" recalls open a Highest-priority request with a same-day due
   date and mark the vehicle "Park It – do not drive" in Assets (at once when someone runs the scan; after the daily
   background scan, on the next open); any open recall marks it "Do not rent" (US Safe Rental Car Act,
   49 U.S.C. 30120(i)).
3. **Proof of repair, in the request.** Schedule the dealer visit, then record the repair order number, date and
   odometer. The vehicle's status updates in Assets and the audit trail stays on the request.

## More details
- Vehicles live in a "Fleet" schema in **JSM Assets** (created for you) with VIN, make, model, year, plate, depot,
  status, driver, equipment and recall dates. No Assets? Roadworthy keeps its own register; paste vehicles in.
- **Fleet compliance board:** open campaigns, vehicles affected, % remedied, overdue, do-not-drive, dispatchable,
  by depot; a "Ruled out" list with reasons; a one-click sample fleet of 25 real-pattern VINs.
- **Daily scan** plus "Scan now"; exactly one request per campaign and vehicle; sidebar badge ("Park It · 2 days open").
- **Rovo agent** "Roadworthy": "Which vans are safe to dispatch today?", "Open recalls at depot North", "Mark ABC-123
  remedied with repair order RO-1842", plus a recall-triage skill.
- **Privacy:** only VINs go to NHTSA vPIC and only make/model/year to the NHTSA recalls API. Nothing else leaves
  your site.

## Screenshots (1840×900, docs/listing/screenshots/)
1. `01-board.png`: board with the Park It banner, KPIs and per-vehicle "Applies" column.
2. `02-ruled-out.png`: the "Ruled out" tab with reasons (engine, drive, converter, equipment).
3. `03-request.png`: a Park It request with the Roadworthy panel: verdict reasons, schedule, mark remedied.
4. `04-assets.png`: the Fleet schema in Assets with a grounded vehicle.

## Links
- Documentation / README: https://github.com/arshdwani/roadworthy
- Privacy: PRIVACY.md · Terms: TERMS.md · Support: SUPPORT.md
