---
name: recall-triage
description: Triage a fleet's open safety recalls for today's dispatch - which vehicles must stay parked, which can run, which repairs to book first, and what to tell drivers and the rental desk. Use when someone asks what is safe to send out, plans a day's routes, or reviews the recall backlog for a depot.
---

# Fleet recall triage

Use the Roadworthy actions; never guess vehicle, VIN, campaign or status.

## Tools
- `get-dispatchable` (Get dispatchable vehicles): input `depot` (optional). Returns `safeToDispatch` and `notSafe`
  (each with status and open recalls) and a `source`.
- `get-open-recalls` (Get open recalls): input `depot` (optional). Returns `openRecalls` with request key, NHTSA
  campaign, severity, component, due date, overdue flag and state, and a `source`.

## Steps
1. Call `get-dispatchable` (with the depot if one was named) and `get-open-recalls` for the same depot.
2. Put vehicles in this order and say so plainly:
   - **Do not drive** (Park It): the manufacturer says the vehicle must not be driven. It needs a tow to the dealer.
   - **Park outside**: fire risk. It may be grounded by fleet policy; never park it indoors or near buildings.
   - **Do not rent**: any other open recall. A US rental company may not rent it (49 U.S.C. 30120(i)); internal use
     depends on the fleet's policy and the recall's consequence.
   - **Safe to dispatch**: no open recalls and status Available.
3. Booking order for repairs: Park It, then Park Outside, then overdue requests, then by due date. Give the request
   key and NHTSA campaign for each.
4. If a request has been open long or is overdue, suggest scheduling the dealer visit from the request's Roadworthy
   panel (Schedule repair), then Mark remedied with the repair order number once fixed.
5. End with one line per depot: dispatchable / total, and the count that must not be driven.

Quote the `source` returned by the actions. If an action returns an error, say what failed and stop.
