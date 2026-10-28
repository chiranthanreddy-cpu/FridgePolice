# FridgePolice implementation notes

## What the application does

FridgePolice is a shared food inventory for roommates. Each item has an owner, a readable unique ID, a quantity, and a status. Roommates request a quantity from a specific item, the owner (or demo user) approves or rejects it, and an approved request can be consumed.

## Inventory accounting invariant

For every available item, `totalQuantity = availableQuantity + reservedQuantity`. `totalQuantity` means physical quantity remaining, including reserved portions. `reservedQuantity` is held for active pending or approved requests, and `availableQuantity` is the unreserved remainder. Quantities are rounded to six decimal places to keep fractional portions stable.

Creating a request decreases available and increases reserved; it does not change total. Rejecting, cancelling, or expiring a request decreases reserved and restores available; total does not change. Consuming an approved request decreases total and reserved by the consumed amount; available does not change because that portion was already reserved.

## The four required scenarios

1. **Double allocation:** `requestPortion` checks available quantity and immediately moves the requested quantity from `availableQuantity` to `reservedQuantity`. The second request sees the reduced availability and fails. Quantity is clamped and validated so it never becomes negative.
2. **Unused approval:** approvals receive a 30-minute `expiresAt`. Pending requests separately receive a 24-hour `pendingExpiresAt`, so pending inventory cannot be held indefinitely. Both kinds of expiration are processed on app load, before relevant actions, and every 30 seconds while the app is open. Expiration is idempotent: only active requests release reservations. An expired request cannot be consumed and its reservation returns to availability. Spoilage sets all usable inventory to zero, cancels pending/approved requests, and blocks further requests or consumption.
3. **Identical names:** every item is created with an ID independent of its name. Requests store and use `itemId`, and the UI shows name, owner, and ID together. Two ketchup records therefore remain separate.
4. **Inventory mismatch:** the correction form selects an exact item ID, accepts the physical quantity, and records a reason in activity history. A correction cannot be below active reservations; otherwise the new available amount is `actual - reserved`, making the physical count the source of truth without silently breaking promises.

## Requests, spoilage, and expiration

Request statuses are `pending`, `approved`, `rejected`, `consumed`, `expired`, and `cancelled`. Item statuses are `available` and `spoiled`. `processExpirations` is an explicit reconciliation function rather than relying only on a browser timer; it runs after loading and around actions. Discarding an item cancels all active requests for that item, clears all inventory, and records the action. Cancelled requests cannot later be approved or consumed.

## Assumptions

- Quantities can be decimal portions (for example, `0.25` pizza).
- There is no backend or authentication; this assignment uses localStorage in one browser.
- Any roommate can use the demo approval controls.
- A physical correction below active reservations is rejected rather than silently cancelling promises. A valid correction becomes the physical source of truth and sets `availableQuantity = totalQuantity - reservedQuantity`.
- Spoiled items cannot be corrected back into usable inventory; correction fails without changing the item.
- If an action fails after expiration reconciliation, the reconciled expiration state is still committed and persisted while the original action error remains visible. If no expiration occurred, the failed action causes no state update.
- There is no backend, authentication, or multi-device synchronization; localStorage is per browser. Any roommate can use the demo approval controls.

## Commands

Run `npm install`, then `npm run dev` for the app. Run `npm test` for the business-logic suite and `npm run build` for the production build.
