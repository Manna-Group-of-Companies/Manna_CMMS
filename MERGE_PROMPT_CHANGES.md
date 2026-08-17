# Supervisor Merge - Confirmation Prompt Changes

## Overview
The supervisor merge flow has been updated to include a **confirmation prompt** before merging stock from Red Stock back to the main store. This eliminates the need to wait for admin approval while giving supervisors a chance to review what they're merging.

## Key Changes

### 1. Removed Admin Approval Wait
- Supervisors no longer need to wait for admin approval to merge their own returned stock
- Merges are applied **immediately after confirmation** by the supervisor
- No more "Pending Approval" status for supervisor merges

### 2. Added Confirmation Prompt
- When a supervisor initiates a merge via `POST /api/merge-requests/mine`, they now receive a confirmation prompt
- The prompt includes:
  - Total quantity to be merged
  - Number of items being merged
  - Destination room (main store)
  - Action buttons: "Yes, Merge Now" or "Cancel"

### 3. Two-Step Merge Process

#### Step 1: Initiate Merge
```
POST /api/merge-requests/mine
Content-Type: application/json
Authorization: Bearer {token}

{
  "comment": "Returning red stock from shelf",
  "restockItemIds": ["item1", "item2"]  // optional
}

Response: 200 OK
{
  "message": "Ready to merge 50 pcs from Red Stock into Main Store. Please confirm.",
  "mergeRequest": { /* full merge request object */ },
  "requiresConfirmation": true,
  "destinationRoom": "Main Store",
  "prompt": {
    "title": "Confirm Merge to Main Store",
    "message": "You are about to merge 50 pcs across 3 item(s) into Main Store. This action cannot be undone.",
    "confirmText": "Yes, Merge Now",
    "cancelText": "Cancel",
    "type": "warning"
  }
}
```

#### Step 2: Confirm & Apply Merge
```
POST /api/merge-requests/{mergeRequestId}/confirm
Content-Type: application/json
Authorization: Bearer {token}

Response: 201 Created
{
  "message": "Merged 50 pcs across 3 item(s) into Main Store. It is in stock now.",
  "mergeRequest": { /* updated merge request with Approved status */ },
  "merged": [ /* array of merged items */ ],
  "skipped": [ /* any items that couldn't be placed */ ]
}
```

## Workflow Comparison

### Before (Old Flow)
1. Supervisor submits merge request → Request created in "Pending Approval" status
2. Admin receives notification
3. Admin reviews and approves the merge
4. Stock moved to main store
5. Supervisor receives notification

### After (New Flow)
1. Supervisor submits merge request → Receives confirmation prompt
2. Supervisor confirms → **Stock moves immediately to main store** (no admin wait)
3. Merge request automatically marked as "Approved"
4. Notifications sent
5. **No admin approval needed** for supervisor merges

## API Changes

### Updated Endpoints
- **POST `/api/merge-requests/mine`** - Now returns a prompt requiring confirmation instead of immediately merging
- **POST `/api/merge-requests/:id/confirm`** (NEW) - Confirms and applies the supervisor's merge

### Removed Functionality
- Admin approval flow for supervisor merges (no longer needed)
- "Pending Approval" status for supervisor-initiated merges

### Security Notes
- Only the supervisor who created the merge can confirm it
- The endpoint verifies the requesting user matches the `requestedBy` field
- Each supervisor can only manage their own merges

## Frontend Implementation

### Show Prompt Dialog
When receiving the response from `POST /api/merge-requests/mine`:

```javascript
if (response.requiresConfirmation) {
  showPromptDialog({
    title: response.prompt.title,
    message: response.prompt.message,
    confirmText: response.prompt.confirmText,
    cancelText: response.prompt.cancelText,
    type: response.prompt.type,
    onConfirm: () => confirmMerge(response.mergeRequest._id),
    onCancel: () => cancelMerge(response.mergeRequest._id)
  });
}
```

### Handle Confirmation
```javascript
async function confirmMerge(mergeRequestId) {
  try {
    const response = await fetch(`/api/merge-requests/${mergeRequestId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      showSuccessNotification(data.message);
      // Refresh merge history
      fetchMyMerges();
    }
  } catch (error) {
    showErrorNotification(error.message);
  }
}
```

## Benefits

✅ **No Admin Wait** - Supervisors get stock back in inventory immediately  
✅ **Safety Check** - Confirmation prompt prevents accidental merges  
✅ **Audit Trail** - All merges still recorded with full history  
✅ **Simplified Admin** - Admin no longer needs to approve routine supervisor merges  
✅ **Direct to Main Store** - Stock goes straight to main inventory  

## Testing

### Test Case 1: Initiate Merge
```bash
curl -X POST http://localhost:5000/api/merge-requests/mine \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Test merge"}'
```
Expected: 200 OK with `requiresConfirmation: true`

### Test Case 2: Confirm Merge
```bash
curl -X POST http://localhost:5000/api/merge-requests/{id}/confirm \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```
Expected: 201 Created with merged items in stock

### Test Case 3: Unauthorized Confirm
```bash
curl -X POST http://localhost:5000/api/merge-requests/{id}/confirm \
  -H "Authorization: Bearer {different_supervisor_token}" \
  -H "Content-Type: application/json"
```
Expected: 403 Forbidden - "You can only confirm your own merges"
