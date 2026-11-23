# Roadworthy: privacy policy

_Last updated: 23 November 2026_

Roadworthy is a Forge app for Jira Service Management. It runs on Atlassian Forge. It calls two public, free US
government APIs run by the National Highway Traffic Safety Administration (NHTSA), and sends them only the data
listed below. This page explains what Roadworthy stores, what it sends, and why.

## What Roadworthy sends outside Atlassian
| Destination | What is sent | Why |
|---|---|---|
| `vpic.nhtsa.dot.gov` (NHTSA vPIC) | Vehicle identification numbers (VINs) only | To decode make, model, model year, engine, drive type and body |
| `api.nhtsa.gov` (NHTSA recalls) | Make, model and model year only | To list the safety recalls for that model |

Nothing else leaves your site: no plates, depots, drivers, Equipment notes, Jira issue content, user names,
account IDs or email addresses. NHTSA's APIs need no account or key. Roadworthy does not use analytics, advertising
or AI services.

## What Roadworthy stores
In Forge hosted storage (Forge Key-Value Store), which Atlassian operates for the site where the app is installed:
- **Vehicles:** a copy of each vehicle's register fields (unit, VIN, make, model, year, plate, depot, status,
  driver, equipment notes, recall dates) and the vPIC decode. With Assets connected, Assets stays the source of
  truth and this copy keeps scans fast and lets the daily scan run without a signed-in user.
- **Recall data from NHTSA:** campaign numbers, components, summaries, consequences and remedies, cached for 12 hours.
- **Remediation records:** the campaign and vehicle, the Jira request key, due date, severity, applicability
  verdict and reasons, the dealer appointment, the repair order number, repair date and odometer, and an audit
  trail with the **Atlassian account IDs** of the people who acted. Names are looked up at display time and not stored.
- **Account IDs and closed accounts:** every week Roadworthy reports the account IDs it stores to Atlassian through
  the Forge personal data reporting API. When Atlassian reports an account as closed, Roadworthy removes that
  account ID from its audit trails and records (the entry then shows "Former user").
- **Settings:** the service project, request type, optional Assets field, and fleet policy switches.

In your Jira site itself, Roadworthy creates the "Fleet" Assets schema and vehicle objects (when you connect Assets),
and creates and updates JSM requests and their comments.

## Access
Roadworthy reads and writes Jira, JSM and Assets through Atlassian's APIs with the signed-in user's permissions
(board, request panel, Rovo actions) or the app's installation permissions (the daily scan).

## Retention and deletion
Data stays until you delete it in Jira or Assets, use "Remove sample fleet", or uninstall the app; Atlassian's Forge
data lifecycle then applies. Account IDs are handled under Atlassian's user privacy framework for Forge apps.

## Contact
Questions or requests: https://github.com/arshdwani/roadworthy/issues
