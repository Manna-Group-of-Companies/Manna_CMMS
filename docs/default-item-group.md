# Default item group on the Add item form

**For:** whoever is working on the CMMS item screens.
**Why:** since 23 Oct 2026 every SAP company keeps its engineering items in one item group, **Engineering Stocks**.
The Add item form should pick it on its own, so nobody has to choose the item group for each new item.

## What is already done (no work needed)

- In SAP, all four companies have an "Engineering Stocks" group, and every engineering item is in it:
  MRPPL 108, MT 123, HRI 108, MTR 115.
- The old groups (MT 110, HRI 106 / 109, MTR 116) are empty, but they are **kept on purpose**, in SAP and in
  the form's list. Do not filter them out.
- The control Single *SAP Item Category Sync Control* now has `default_group` on each company in
  `item_master_options`:

  ```json
  "MT": { "company": "...", "groups": [ { "code": 110, "name": "TOOLS AND EQUIPMENTS", "prefix": "" },
                                        { "code": 123, "name": "Engineering Stocks", "prefix": "" } ],
          "default_group": "Engineering Stocks", ... }
  ```

  The sync keeps this key when it refreshes the options. It is set for all four companies.

## Change 1: server - pass `default_group` to the form

`server/repository/namingRequests.js`, `requestOptions()` (about line 188) lists each field it sends, so
`default_group` doesn't reach the client today. Add one field to the object returned per company:

```js
    hsn: o.hsn || [],
    // The group the Add form picks by itself (23 Oct 2026: "Engineering Stocks" everywhere).
    // Only when it is one of the company's groups, so a stale value never fills the form.
    defaultGroup: (o.groups || []).some((g) => g.name === o.default_group) ? o.default_group : "",
```

## Change 2: client - pick it when adding

`client/src/pages/admin/ProductFormModal.jsx`, next to the existing "One company in the list? Pick it." effect
(about line 131):

```jsx
  // The company's default item group (Engineering Stocks)? Pick it - still changeable in the list.
  useEffect(() => {
    if (!isEdit && company?.defaultGroup && !form.itemGroup) {
      setForm((f) => ({ ...f, itemGroup: company.defaultGroup }));
    }
  }, [company, isEdit, form.itemGroup]);
```

How it should behave:

- **Add form:** as soon as a company is chosen (or auto-picked when there is only one), the Item group shows
  "Engineering Stocks". Choosing another company clears the group (as `set("company")` does today) and the
  effect fills in that company's default.
- **The dropdown stays.** The user can still change the group, and the old groups are still in the list.
- **Edit form:** nothing changes (`!isEdit`). An existing item keeps its own group.
- **No default** (`defaultGroup` empty): the form behaves exactly as today.
- **Saved drafts:** a restored draft with a group already chosen keeps it (`!form.itemGroup`).
- Sub-category A / B start empty, as they do now after a group is chosen.

## Optional

- Under the Item group field, a hint such as "Engineering Stocks is picked for you" makes the change visible.
- The edit form's "(CMMS only - not sent to SAP)" labels on Foreign name and Minimum stock are out of date
  since 23 Oct 2026: both are now sent to SAP (PR #16).

## How to check

1. Add item → choose each company in turn → the Item group shows "Engineering Stocks" every time.
2. Change the group by hand → it stays changed; change the company → it goes back to that company's default.
3. Save a new item → the sync creates it in SAP in the Engineering Stocks group, with the usual code
   (MRPPL / HRI / MTR `ENG-<n>`, MT SAP series 104).
4. Edit an existing item → its group is unchanged.
