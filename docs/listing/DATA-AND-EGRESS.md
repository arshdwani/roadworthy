# Data and egress statement

Roadworthy declares two backend egress destinations in its manifest, both public NHTSA (US Department of
Transportation) APIs that need no key:

| Address | `inScopeEUD` | Data sent | Calls |
|---|---|---|---|
| `https://vpic.nhtsa.dot.gov` | true (VINs are customer content) | VINs, up to 50 per call | `POST /api/vehicles/DecodeVinValuesBatch/` |
| `https://api.nhtsa.gov` | false | make, model, model year | `GET /recalls/recallsByVehicle`, `GET /products/vehicle/models` |

- No other field leaves the site: not plates, depots, drivers, equipment notes, Jira or Assets content, user
  identifiers or email addresses.
- Responses are cached in Forge storage for 12 hours per make, model and year, so a 500-vehicle fleet of 40 models
  makes about 40 recall calls and 10 decode calls a day.
- There is no frontend egress and no remote backend. All other processing (matching, verdicts, severity, due
  dates) is deterministic code running in Forge functions.
- Because of the NHTSA egress, the app is **not** eligible for "Runs on Atlassian".
