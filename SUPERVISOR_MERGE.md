# Supervisor Merge — Applied on Click

## What happens

A Supervisor merging Red Stock does not wait for anyone. One call puts the
stock in the main store room:

```
POST /api/merge-requests/mine
Authorization: Bearer {supervisor token}

{
  "comment": "Returning red stock from shelf",   // optional
  "restockItemIds": ["item1", "item2"]           // optional; omit for everything
}

Response: 201 Created
{
  "message": "Merged 50 pcs across 3 item(s) into Main Store. It is in stock now.",
  "mergeRequest": { /* closed as Approved, with its request id */ },
  "merged":  [ /* what moved, and into which room */ ],
  "skipped": [ /* anything no room could be found for */ ]
}
```

**Any supervisor may merge any return**, not only the ones they booked in
themselves — the same rule returns already follow, since the supervisors run one
store between them and whoever is on shift handles the stock. `requestedBy`
records who merged it, which is not necessarily who returned it. Two supervisors
merging at once is safe: an item can only be claimed once, and the second merge
is told another one claimed it first.

The MergeRequest is still written and closed as `Approved`, so the merge keeps
its request id, its ledger entries and its place in the Admin's history. Only
the waiting is gone. **No Admin approval is involved at any point**, and a
supervisor merge never reaches `Pending Approval`.

If the supervisor should see a "are you sure" step, the client asks it before
posting. The server does not hold stock while a prompt is on screen.

## Errors

| Status | When |
| --- | --- |
| 409 | Nothing in Red Stock to merge |
| 409 | The install has no active store room — the stock stays in Red Stock and the request is withdrawn |
| 201 with `skipped` | Some lines had no room; the message names what stayed behind |

## Merges an older build parked

One build in between claimed the stock and parked the request at
`Pending Approval`, waiting for a second call the clients never made. Their
stock is out of Red Stock and in no store room, so it is countable nowhere.

`settleParkedSupervisorMerges()` runs at startup ([server/index.js](server/index.js))
and puts every one of them into the main store room, crediting the supervisor
who raised it. It is quiet when there is nothing parked, and it never asks an
Admin. A merge it cannot place — no active store room — is withdrawn, which
puts that stock back in Red Stock, mergeable again.

`POST /api/merge-requests/:id/confirm` does the same for one request on demand,
so a supervisor can clear a parked merge without waiting for a restart. It is
not part of the normal flow — `/mine` merges in one call and never reaches it.

- Only a merge with `createdVia: "Supervisor"`, whoever raised it — the weekly
  merge is the Admin's, and a request with any other `createdVia` is a 403.
- Already `Approved` → 200, saying where the stock is. Safe to retry.
- `Rejected` → 409; the stock is back in Red Stock and can be merged again.

## What still needs the Admin

The weekly merge. It sweeps every supervisor's returns at once and that one
does need a decision, so `POST /api/merge-requests/weekly` and the
`approve` / `reject` endpoints are unchanged. It cannot lock a supervisor out
of the room: raising a supervisor merge takes those returns back out of an open
weekly merge first.
