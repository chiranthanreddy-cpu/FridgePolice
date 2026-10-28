# FridgePolice

FridgePolice is a local-only React/Vite dashboard for roommates who want a fair shared fridge. It tracks ownership, available and reserved portions, requests, approvals, consumption, spoilage, and physical inventory corrections. It includes demo data for Alex, Bri, and Casey so every scenario can be shown immediately.

## Inventory model

For every usable item, the exact invariant is:

`totalQuantity = availableQuantity + reservedQuantity`

`totalQuantity` is the physical quantity remaining, including portions held for requests. `reservedQuantity` is held by active pending or approved requests, and `availableQuantity` is what is not reserved. Requests move quantity from available to reserved without changing the physical total. Rejection, cancellation, and expiration release the reservation. Consumption reduces both total and reserved; available is unchanged by consumption because it was already reserved. Fractional values are rounded to six decimal places.

Pending requests expire after 24 hours. Approved requests expire after 30 minutes. Expiration is reconciled on load, before relevant operations, and periodically while the app is open, so it does not depend only on a running browser timer. Spoilage sets all usable quantities to zero and cancels outstanding requests.

Inventory correction sets the physical total to the reported quantity and recalculates availability. It cannot set the physical count below active reservations, and every correction reason is recorded in the activity history.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Data is saved in browser `localStorage`; use **Reset demo data** to restore the starting scenario.

## Test and build

```bash
npm test
npm run build
```

## Project structure

- `src/domain/fridge.js` - centralized, UI-independent inventory and request rules.
- `src/domain/fridge.test.js` - Vitest coverage for allocation, both expiration policies, spoilage, IDs, correction, fractional quantities, validation, and negative-inventory protection.
- `src/App.jsx` - dashboard forms, controls, notices, and localStorage lifecycle.
- `src/styles.css` - responsive visual design.
- `Changes.md` - beginner-friendly explanation of the required scenarios and accounting model.
