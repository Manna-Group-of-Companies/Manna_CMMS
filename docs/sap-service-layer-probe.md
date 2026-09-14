# SAP Service Layer — can we create an item?

The prompt below is for a Claude session running on the SAP server in PowerShell.
Its whole job is to answer one question without writing anything: **can this login
create an item master through the Service Layer, and what would that item need to
look like?**

Written for **SAP Business One**, whose OData API is the thing called the "Service
Layer". If the system turns out to be S/4HANA or ECC, the prompt tells the session
to stop rather than improvise.

Paste everything between the rules.

---

You are working on the SAP integration for the Manna Group CMMS (Engineering Stock
Manager). The engineering store's item naming and approval flow currently ends in
ERPNext; approved items have to end up in SAP as item masters. The SAP team has
opened the Service Layer and believes it accepts writes, but nothing outside SAP has
ever written to this system. This will be the first, so the priority is certainty,
not speed.

**Your goal this session: determine whether the SAP login available on this machine
can create an item master through the Service Layer — without creating one.**

## Hard rules

1. **Do not create, update or delete any record in SAP this session.** Read only. If
   you conclude the question cannot be answered without a write, stop and say so.
   Do not decide for yourself that one small write is acceptable.
2. **Never modify an existing record**, in this session or any later one. Nothing we
   are doing requires it.
3. Do not print passwords or session IDs. Read them from wherever they live, use
   them, never echo them.
4. Report uncertainty as uncertainty. A confident wrong answer here ends with a
   corrupted item master in a production ERP, which is a much worse day than "I
   could not determine this."

## Environment

- Windows, PowerShell.
- SAP Business One Service Layer, normally `https://<host>:50000/b1s/v1/`.
  **If this is S/4HANA, ECC, or anything that is not B1, stop immediately and say
  so** — none of the specifics below apply.
- Do not guess the host, company database or credentials. Find them: environment
  variables, config files, an existing integration or scheduled task on this
  machine, DI API configs. If you cannot find them, ask me.

## PowerShell notes that will otherwise cost you an hour

- The Service Layer almost always presents a self-signed certificate. PowerShell 7:
  `-SkipCertificateCheck`. PowerShell 5.1: set a
  `[Net.ServicePointManager]::ServerCertificateValidationCallback` and force
  `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`.
- Keep the session with `-SessionVariable` / `-WebSession`. The `B1SESSION` cookie
  expires after about 30 minutes of inactivity.
- Errors return as `{"error":{"code":...,"message":{"value":"..."}}}`. Always print
  the `value` — it is the real reason, and the HTTP status alone is usually useless.
- `Invoke-RestMethod` swallows the response body on a non-2xx. Catch the exception
  and read `$_.ErrorDetails.Message`, or you will report "400 Bad Request" when SAP
  told you exactly what was wrong.

## Phase 1 — read only. Do all of it, then stop and report.

1. **Reachability.** Confirm the Service Layer answers, and report its version and
   the exact base URL that worked (v1 vs v2 matters later).
2. **Company databases.** `POST /b1s/v1/CompanyService_GetCompanyList`. I especially
   want to know **whether a test or sandbox company exists**, because that is where
   a first write belongs. Report every company name and database name you get.
3. **Login.** Report which company DB and user succeeded. If it fails, report the
   exact SAP error code — B1 distinguishes bad credentials from a locked account
   from an exhausted licence, and those need very different responses.
4. **Who the user is and what they may do.** `GET /b1s/v1/UsersInfo`, plus the
   user's authorisations — specifically the **Item Master Data** authorisation and
   whether this is a superuser. *This is the actual question.* Read access proves
   nothing about write access, so do not report "I could read Items" as though it
   were evidence that we can create one.
5. **What an Item requires.** Read the `Items` entity from `$metadata` and list the
   properties that are mandatory on create, with their types and any enums.
6. **House conventions.** `GET /b1s/v1/Items?$top=5`. Report how `ItemCode` is
   actually formed, which `ItemsGroupCode` values are in use, how UoM is handled,
   and which user-defined fields (`U_*`) are populated. Our items must match these
   or they will be wrong even when SAP accepts them.
7. **Item groups.** `GET /b1s/v1/ItemGroups?$select=Number,GroupName`. Which group
   should engineering and maintenance spares go into, or does one need creating?
8. **Numbering.** Are item codes entered manually or drawn from a numbering series?
   Report how you determined it.
9. **Licensing.** Service Layer sessions consume a licence. Report what you can see.
   An integration that logs in per request will exhaust them, and I need to know
   that before designing it, not after.

## What to report back

Lead with a direct answer to the one question, in plain words. Then the evidence.
Then anything that would make the first real write risky.

Separate explicitly:

- what you **verified** (you saw it in a response),
- what you **inferred** (reasonable, but not directly observed),
- what you **could not determine**.

Also capture the exact request and response for the calls that mattered, so I can
hand them to the SAP team without you having to be in the room.

## Phase 2 — only if I reply approving it

Do not begin this on your own initiative. If I approve a live trial:

- Use a **test company database** if one exists. If none does, say so and wait — I
  will decide whether to proceed against production.
- Create **exactly one** item, with an ItemCode obviously marked as a test
  (`ZZTEST-CMMS-01`) and a name that says the same.
- Read it back and confirm what SAP actually stored, field by field. SAP silently
  defaults fields you did not send, and those defaults are the interesting part.
- Delete it: `DELETE /b1s/v1/Items('ZZTEST-CMMS-01')`, then confirm it is gone.
  A new item with no transactions against it should delete cleanly. **If the delete
  is refused, report it immediately and stop** — it means we cannot clean up after
  ourselves, and every future test leaves permanent residue in the item master.
- Touch nothing else. One item, verified, removed, reported.
