# Roadworthy

Fleet safety-recall compliance for **Jira Service Management**: vehicles in **JSM Assets** are decoded with
**NHTSA vPIC**, checked every day against **live NHTSA recalls**, ruled in or out **per vehicle with reasons**, and
every real match becomes one JSM remediation request. "Park It" recalls ground the vehicle at once; the dealer
visit and the repair order close the loop and put the vehicle back in service.

Built for Atlassian Codegeist 2026 (Apps for Specialized Industries: automotive and fleets). Forge, UI Kit, Jira only.

## Why
**Maria runs compliance for a 300-vehicle rental fleet.** NHTSA's recall lookup by model gives her 900 lines a
quarter; most don't apply to her cars, and the ones that do can't be rented until they're fixed. She needs to know,
every morning, which vehicles must stay parked and which recalls are noise, and to prove each fix.

- Manufacturers issue about 900 US safety recalls a year. Fleet operators (delivery, rental, utilities,
  municipal) have to track them across hundreds of vehicles, usually in spreadsheets.
- **Rental fleets are legally bound:** the Raechel and Jacqueline Houck Safe Rental Car Act of 2015 (FAST Act,
  Pub. L. 114-94, div. B, title XXIV, § 24109, Dec 4 2015; 49 U.S.C. 30102(a), 30120(i)) forbids a rental company
  with 35 or more vehicles from renting or selling a vehicle with an open recall until it is repaired. Vehicles must
  be grounded within 24 hours of notice (48 hours above 5,000 affected vehicles). It is named for two sisters killed
  in 2004 in a recalled, unrepaired rental car.
- NHTSA's public API lists recalls by **make, model and year**, not by VIN, so naive tools flood fleets with recalls
  that don't apply (a wheelchair-lift recall on cargo vans, an AWD recall on rear-drive vans). Roadworthy's
  headline feature is telling you which vehicles actually need the dealer, and why.

## What it does
1. **Register:** a "Fleet" Assets schema with a Vehicle type (VIN, make, model, model year, plate, depot, status,
   driver, equipment, last recall check, recalls verified to, open recalls). Created for you; or use the in-app
   register (no Assets needed) and paste vehicles as CSV.
2. **Decode and match:** vPIC decodes each VIN (engine, fuel, drive, body, plant); recalls come from NHTSA per
   make/model/year (cached 12 h; model-name fallback such as "ProMaster 2500" → "PROMASTER").
3. **Per-vehicle verdicts** (`src/core/applicability.js`): the recall's scope sentence is parsed into a model list
   and a qualifying tail and compared with the vehicle:
   - engine size ("2.7L or 3.0L EcoBoost"), fuel ("Maverick Hybrid", "HEV or PHEV"), drive ("All Wheel Drive")
   - converter and equipment-maker recalls (Rollx, Quality Vans): manufacturer ≠ vehicle maker
   - equipment the VIN can't show (screen size, tow hitch, key type, sunroof, wheelchair lift), read from the
     vehicle's **Equipment** notes ("12-inch SYNC screen", "no tow hitch", "push-button start")
   - earlier repairs ("previously repaired under 21V-650"), chained through Roadworthy's own records
   Each match is **Likely**, **Possibly** (confirm with the NHTSA VIN lookup) or **Unlikely** (listed under "Ruled
   out", no request, "Open request" available). Roadworthy only rules out on facts: the VIN decode (engine, fuel,
   drive, plant) or what the fleet recorded ("12-inch screen", "no tow hitch", "no conversions"). Anything uncertain
   (a VIN that doesn't decode, a recall filed by another brand of the same group, a plant it can't map, a converter's
   recall with no conversion record) stays **Possibly**.
4. **Requests:** one JSM request per campaign and vehicle (KVS `FAIL_IF_EXISTS` claim), raised by the app, with the
   campaign, summary, consequence, remedy, verdict reasons, a due date by severity and a smart link to the asset.
   Park It / Park Outside: Highest priority, due the same day, vehicle status "Park It – do not drive"; any other
   open recall: "Do not rent". When a person runs the scan, the Assets status changes at once. After the daily
   background scan the request opens immediately, and the vehicle's Assets status updates the next time someone
   opens Roadworthy (Assets doesn't accept app-only writes yet, Atlassian ECO-1808).
   Vehicles without a "Recalls verified to" date don't get a request for every recall since they were built:
   campaigns older than 12 months go to a **Check once** list (no request, no restriction).
5. **Remediation panel** on the request: Schedule (dealer, date) → Mark remedied (repair order, date, odometer) or
   Not affected; status flows back to Assets; internal notes and an audit trail.
6. **Fleet compliance board** (Jira global page): KPIs, Park It banner, open recalls, ruled out, depots chart,
   vehicles, settings, getting started, load and remove sample fleet.
7. **Rovo agent and skill:** dispatchable vehicles, open recalls by depot, mark remedied; recall-triage skill.

## Requirements
- Jira Service Management with at least one service project (requests go to the project and request type chosen
  in Settings; default: the best-fitting project, e.g. Facilities). Settings warns when the request type has
  required fields Roadworthy can't fill, and can create a "Vehicle safety recall" request type. Without a service
  project, recall work items go to a regular Jira project you choose.
- JSM Assets (optional). Creating the Fleet schema needs an Assets admin; reading and updating vehicles uses the
  signed-in user's Assets permissions. Assets refuses app-only calls today (Atlassian ECO-1808), so the daily scan
  queues vehicle status changes and the board applies them when someone opens it ("Pending updates applied").

## Setup
```bash
cd app && npm install
../bin/forge deploy -e development
../bin/forge install --site <site>.atlassian.net --product jira -e development
```
Open Apps → Roadworthy → Settings (service project, request type, optional Assets link field), then
"Load sample fleet" or add vehicles, then "Scan now".

## Architecture
```
app/src/core/        pure logic, unit-tested: vin (check digit), decode (vPIC), recalls (NHTSA parsing, model map),
                     applicability (per-vehicle verdicts), severity (priority, due dates), fleet (status rules,
                     board numbers), scan (planning), adf (request text), csv, sample (25 real-pattern VINs)
app/src/nhtsa.js     vPIC batch decode + recalls with a 12 h KVS cache       (only VIN / make-model-year leave the site)
app/src/assets.js    Assets REST via requestJira (/jsm/assets/workspace/{id}/v1/...): schema, type, attributes, objects
app/src/vehicles.js  register: Assets + KVS mirror, or KVS only; queued writes when Assets refuses app calls
app/src/scan.js      resumable scan job (load → decode → recalls → open → status) under the 25 s resolver limit
app/src/jira.js      JSM requests, fields, comments, transitions
app/src/service.js   board, settings, sample data, remediation, review overrides
app/src/frontend/    UI Kit: board.jsx (global page), panel.jsx (issue panel + sidebar badge)
```

## Tests
`cd app && npm test` runs offline with recorded NHTSA responses: core logic, per-vehicle verdicts on real recall
text, and the whole backend end to end against a fake Jira/JSM/Assets site (Assets and no-Assets).
`node --experimental-test-module-mocks --test test/live/nhtsa.live.mjs` checks the live NHTSA APIs.

## Data and privacy
See `docs/listing/PRIVACY.md` and `docs/listing/DATA-AND-EGRESS.md`. License: MIT.
