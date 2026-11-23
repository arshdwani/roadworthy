# Marketplace listing: field-by-field (Roadworthy, Forge app 25c23b78-f21b-4f88-9642-8beb9cd81d16)

Assets: `docs/listing/assets/` · Copy source: `LISTING.md`, `DATA-AND-EGRESS.md`, `SCOPES.md`.

## Prerequisites (done / pending)
- [x] Console name "Roadworthy", description, avatar (icon) set on the Marketplace copy app.
- [x] Distribution: Sharing with anyone, Jira; company "Arshd Wani"; support https://github.com/arshdwani/roadworthy/issues;
      privacy/terms = the GitHub PRIVACY.md / TERMS.md URLs; "Stores personal data?" = Yes (Atlassian account IDs in audit trails).
- [ ] ⛔ USER: publish the Developer Space `arshd-wani` (Console → Developer Space → Settings → Make public on Marketplace →
      Review & publish → accept the Marketplace Partner Agreement). Needs a billing account + billing consent on the space.
      NOTE: this creates its own Marketplace partner; the separately created vendor 164116593 cannot list apps from this space.
- [ ] Then: Marketplace → Publish a new app → Vendor = the published space → "Choose a Forge app" = Roadworthy.

## App basics
- App name: **Roadworthy**  (alt if taken: "Roadworthy: Fleet Recall Compliance")
- Hosting: Cloud · Product: Jira (Jira Service Management) · Payment model: Free
- Tagline (≤ 90): Find the vehicles that really need a recall repair, ground them, and prove the fix in JSM.
- Summary (≤ 250): Roadworthy checks every vehicle in JSM Assets against live NHTSA safety recalls each day, rules recalls in or out per VIN with reasons, opens one JSM request per real match, and grounds "Park It" vehicles until the repair is proven.
- Categories: IT & helpdesk · Asset management · Workflow
- Keywords: recall, fleet, NHTSA, VIN, vehicle, Assets, compliance, rental, safety
- Links: Documentation https://github.com/arshdwani/roadworthy · Support https://github.com/arshdwani/roadworthy/issues ·
  Privacy https://github.com/arshdwani/roadworthy/blob/main/docs/listing/PRIVACY.md · EULA/Terms https://github.com/arshdwani/roadworthy/blob/main/docs/listing/TERMS.md
- Logo: `assets/logo-144.png` · Banner: `assets/banner-1120x548.png`

## Highlights (3)
1. Title: **Per-vehicle recall verdicts, with reasons**
   Summary: NHTSA lists recalls by model. Roadworthy reads each recall's scope against the VIN decode and your equipment notes, and says likely, possibly or unlikely affected, with the reason.
   Screenshot: `assets/highlight-1-verdicts-1840x900.png` · Cropped: `assets/highlight-1-verdicts-cropped-580x330.png`
   Caption: The Ruled out tab: each NHTSA match that doesn't apply to the specific vehicle, with the reason from the VIN decode or the fleet's equipment notes.
2. Title: **Park It means parked**
   Summary: Park It and Park Outside recalls open a Highest-priority JSM request due today and ground the vehicle in Assets. Any open recall marks it Do not rent (US Safe Rental Car Act).
   Screenshot: `assets/highlight-2-park-it-1840x900.png` · Cropped: `assets/highlight-2-park-it-cropped-580x330.png`
   Caption: The fleet compliance board after a live scan: 28 NHTSA matches, 16 need action, 12 ruled out, and the vehicles that must not be driven.
3. Title: **Proof of repair in the request**
   Summary: Schedule the dealer visit, then record the repair order, date and odometer. The vehicle's status updates in Assets and the audit trail stays on the request.
   Screenshot: `assets/highlight-3-request-1840x900.png` · Cropped: `assets/highlight-3-request-cropped-580x330.png`
   Caption: A Park It request with the Roadworthy panel: why the recall applies to this truck, the NHTSA VIN lookup, and the schedule and remedy steps.
- Additional screenshot: `assets/highlight-4-assets-1840x900.png` — Vehicles live in JSM Assets; status follows the recalls.

## Description (More details)
Use LISTING.md "More details" + "Highlights". Mention: Jira only; works with or without Assets; Rovo agent + skill; only VINs and make/model/year go to NHTSA.

## Release
- Release summary (≤ 80): First release: per-vehicle NHTSA recall verdicts for JSM and Assets
- Release notes: Fleet register in JSM Assets (or built-in register); daily NHTSA scan; per-vehicle verdicts; one request per campaign × vehicle; Park It grounding; schedule → remedied with audit trail; Rovo agent and skill.

## Privacy & Security tab (honest answers)
- Data storage: Forge hosted storage only (KVS) on Atlassian; no external database. Data residency: Forge KVS (in-scope EUD: vehicle records, recall records, audit trails).
- External egress: yes — `https://vpic.nhtsa.dot.gov` (VINs only) and `https://api.nhtsa.gov` (make, model, model year only). Public US government APIs, no account, HTTPS. No other egress, no analytics, no AI services.
- Personal data: stores Atlassian account IDs (who scheduled/remedied, in audit trails). No names, emails or customer PII. Driver names typed into the vehicle register are customer content stored in Assets/KVS.
- Personal data reporting: yes. A weekly scheduled trigger reports every stored account ID (with its last-updated time)
  via `privacy.reportPersonalData` (Forge personal data reporting API) and erases closed accounts' IDs from audit
  trails, "check once" records and the scan job (shown as "Former user"). No profile data is kept, so "updated"
  accounts need no action. Code: `app/src/privacy.js`, `app/src/core/privacy.js` (unit tested).
- Data retention/deletion: until deleted in Jira/Assets, "Remove sample fleet", or uninstall (Forge data lifecycle).
- Encryption: Atlassian-managed (Forge platform) at rest and in transit; NHTSA calls over HTTPS.
- Logging: no personal data logged; errors only.
- Security contact / incident: GitHub issues (or a contact email the user chooses).

## Scopes and egress justifications
Paste from `SCOPES.md` (one line per scope) and `DATA-AND-EGRESS.md` (two hosts, data sent, why).
