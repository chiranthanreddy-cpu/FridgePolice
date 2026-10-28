import { describe, expect, it } from 'vitest'
import {
  addFoodItem,
  approveRequest,
  consumeRequest,
  correctInventory,
  createDemoState,
  discardFood,
  executeAction,
  processExpirations,
  rejectRequest,
  requestPortion,
  APPROVAL_TTL_MS,
  PENDING_TTL_MS,
} from './fridge'

const base = (quantity = 0.25) => ({
  roommates: ['A', 'B', 'C'],
  items: [{ id: 'i1', name: 'Pizza', owner: 'A', totalQuantity: quantity, availableQuantity: quantity, reservedQuantity: 0, unit: 'pizza', status: 'available' }],
  requests: [],
  activities: [],
})
const request = (state = base(), quantity = 0.25, now = 1_000) => requestPortion(state, { itemId: 'i1', requester: 'B', quantity }, now)

describe('FridgePolice inventory rules', () => {
  it('starts the pizza demo with all 0.25 available', () => {
    expect(createDemoState(1).items[0]).toMatchObject({ totalQuantity: 0.25, availableQuantity: 0.25, reservedQuantity: 0 })
  })

  it('allows only one roommate to reserve the final 0.25 pizza', () => {
    const first = request(base(), 0.25, 1_000)
    expect(first.items[0]).toMatchObject({ totalQuantity: 0.25, availableQuantity: 0, reservedQuantity: 0.25 })
    expect(() => requestPortion(first, { itemId: 'i1', requester: 'C', quantity: 0.25 }, 1_001)).toThrow(/Not enough/)
  })

  it('does not reduce total physical quantity when requesting', () => {
    const next = request(base(1), 0.3)
    expect(next.items[0]).toMatchObject({ totalQuantity: 1, availableQuantity: 0.7, reservedQuantity: 0.3 })
  })

  it('reduces total and reserved quantities consistently when consumed', () => {
    const pending = request(base(1), 0.3, 1_000)
    const approvedPending = approveRequest(pending, pending.requests[0].id, 2_000)
    const consumed = consumeRequest(approvedPending, pending.requests[0].id, 2_001)
    expect(consumed.items[0]).toMatchObject({ totalQuantity: 0.7, availableQuantity: 0.7, reservedQuantity: 0 })
    expect(consumed.requests[0].status).toBe('consumed')
  })

  it('rejecting a request releases its reservation', () => {
    const pending = request(base(1), 0.3)
    const rejected = rejectRequest(pending, pending.requests[0].id, 2_000)
    expect(rejected.items[0]).toMatchObject({ totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0 })
    expect(rejected.requests[0].status).toBe('rejected')
  })

  it('expires an approved request and releases its reservation', () => {
    const pending = request(base(1), 0.3, 1_000)
    const approved = approveRequest(pending, pending.requests[0].id, 2_000)
    const expired = processExpirations(approved, 2_000 + APPROVAL_TTL_MS + 1)
    expect(expired.requests[0].status).toBe('expired')
    expect(expired.items[0]).toMatchObject({ totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0 })
    expect(() => consumeRequest(expired, expired.requests[0].id, 2_000 + APPROVAL_TTL_MS + 2)).toThrow(/approved/)
  })

  it('expires a pending request after the documented 24-hour policy', () => {
    const pending = request(base(1), 0.3, 1_000)
    const expired = processExpirations(pending, 1_000 + PENDING_TTL_MS + 1)
    expect(expired.requests[0].status).toBe('expired')
    expect(expired.items[0]).toMatchObject({ totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0 })
    expect(expired.activities[0].text).toMatch(/pending request expired/)
  })

  it('makes expiration processing idempotent', () => {
    const pending = request(base(1), 0.3, 1_000)
    const once = processExpirations(pending, 1_000 + PENDING_TTL_MS + 1)
    const twice = processExpirations(once, 1_000 + PENDING_TTL_MS + 2)
    expect(twice.items[0]).toEqual(once.items[0])
    expect(twice.activities).toHaveLength(once.activities.length)
  })

  it('keeps expiration changes when the following action fails', () => {
    const pending = request(base(1), 0.3, 1_000)
    const result = executeAction(pending, () => {
      throw new Error('Requested action failed')
    }, 1_000 + PENDING_TTL_MS + 1)
    expect(result.error).toEqual(new Error('Requested action failed'))
    expect(result.state.requests[0].status).toBe('expired')
    expect(result.state.items[0]).toMatchObject({ totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0 })
    expect(result.state).not.toBe(pending)
  })

  it('does not replace state when a failed action has no expirations to process', () => {
    const pending = request(base(1), 0.3, 1_000)
    const result = executeAction(pending, () => {
      throw new Error('Requested action failed')
    }, 1_001)
    expect(result.error).toEqual(new Error('Requested action failed'))
    expect(result.state).toBe(pending)
  })

  it('prevents requests and consumption for spoiled food', () => {
    const spoiled = discardFood(createDemoState(1), 'item-pizza', 2)
    expect(() => requestPortion(spoiled, { itemId: 'item-pizza', requester: 'B', quantity: 0.1 }, 3)).toThrow(/Spoiled/)
    expect(() => consumeRequest(spoiled, 'missing-request', 3)).toThrow(/approved/)
  })

  it('does not revive spoiled food through inventory correction', () => {
    const spoiled = discardFood(createDemoState(1), 'item-pizza', 2)
    expect(() => correctInventory(spoiled, { itemId: 'item-pizza', actualQuantity: 0.25, reason: 'manual correction' }, 3)).toThrow(/Spoiled/)
    expect(spoiled.items.find((item) => item.id === 'item-pizza')).toMatchObject({ status: 'spoiled', totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 })
  })

  it('cancels pending and approved requests when an item is discarded', () => {
    const pending = request(base(1), 0.2, 1_000)
    const approved = approveRequest(pending, pending.requests[0].id, 2_000)
    const second = requestPortion(approved, { itemId: 'i1', requester: 'C', quantity: 0.1 }, 2_001)
    const discarded = discardFood(second, 'i1', 2_002)
    expect(discarded.items[0]).toMatchObject({ status: 'spoiled', totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 })
    expect(discarded.requests.every((candidate) => candidate.status === 'cancelled')).toBe(true)
    expect(() => approveRequest(discarded, second.requests[0].id, 2_003)).toThrow(/pending/)
    expect(() => consumeRequest(discarded, second.requests[0].id, 2_003)).toThrow(/approved/)
    expect(discarded.activities[0].text).toMatch(/discarded/)
  })

  it('keeps identically named food items independent', () => {
    const first = addFoodItem(createDemoState(1), { name: 'Ketchup', owner: 'Alex', quantity: 2, unit: 'bottles' }, 2)
    const state = addFoodItem(first, { name: 'Ketchup', owner: 'Bri', quantity: 1, unit: 'bottle' }, 3)
    const ketchup = state.items.filter((item) => item.name === 'Ketchup')
    const updated = requestPortion(state, { itemId: ketchup[0].id, requester: 'Casey', quantity: 1 }, 4)
    expect(ketchup[0].id).not.toBe(ketchup[1].id)
    expect(updated.items.find((item) => item.id === ketchup[0].id).availableQuantity).toBe(0)
    expect(updated.items.find((item) => item.id === ketchup[1].id).availableQuantity).toBe(ketchup[1].availableQuantity)
  })

  it('respects existing reservations during inventory correction', () => {
    const pending = request(base(1), 0.3)
    expect(() => correctInventory(pending, { itemId: 'i1', actualQuantity: 0.2, reason: 'missing' }, 2_000)).toThrow(/reserved/)
    const corrected = correctInventory(pending, { itemId: 'i1', actualQuantity: 0.8, reason: 'eaten without recording' }, 2_001)
    expect(corrected.items[0]).toMatchObject({ totalQuantity: 0.8, availableQuantity: 0.5, reservedQuantity: 0.3 })
  })

  it('cannot create negative available inventory', () => {
    expect(() => correctInventory(base(1), { itemId: 'i1', actualQuantity: -1, reason: 'manual correction' }, 2_000)).toThrow(/zero or greater/)
    const pending = request(base(1), 0.3)
    expect(() => correctInventory(pending, { itemId: 'i1', actualQuantity: 0.29, reason: 'missing' }, 2_000)).toThrow(/reserved/)
  })

  it('keeps fractional quantities accurate', () => {
    const next = request(base(0.3), 0.1 + 0.2, 1_000)
    expect(next.items[0]).toMatchObject({ totalQuantity: 0.3, availableQuantity: 0, reservedQuantity: 0.3 })
  })

  it('rejects invalid or missing item and request fields', () => {
    expect(() => addFoodItem(base(), { name: ' ', owner: 'A', quantity: 1 }, 1)).toThrow(/Food name/)
    expect(() => addFoodItem(base(), { name: 'Milk', owner: '', quantity: 1 }, 1)).toThrow(/Owner/)
    expect(() => addFoodItem(base(), { name: 'Milk', owner: 'A', quantity: 0 }, 1)).toThrow(/greater/)
    expect(() => requestPortion(base(), { itemId: 'i1', requester: '', quantity: 0.1 }, 1)).toThrow(/Requester/)
    expect(() => requestPortion(base(), { itemId: 'i1', requester: 'B', quantity: 0 }, 1)).toThrow(/greater/)
    expect(() => requestPortion(base(), { itemId: 'missing', requester: 'B', quantity: 0.1 }, 1)).toThrow(/not found/)
  })
})
