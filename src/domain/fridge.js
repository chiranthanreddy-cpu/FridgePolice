export const APPROVAL_TTL_MS = 30 * 60 * 1000
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000
export const REQUEST_STATES = ['pending', 'approved', 'rejected', 'consumed', 'expired', 'cancelled']

const QUANTITY_SCALE = 1_000_000
const roundQuantity = (value) => Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE
const nowIso = (now = Date.now()) => new Date(now).toISOString()
const makeId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function createDemoState(now = Date.now()) {
  return {
    roommates: ['Alex', 'Bri', 'Casey'],
    items: [
      { id: 'item-pizza', name: 'Pizza', owner: 'Alex', totalQuantity: 0.25, availableQuantity: 0.25, reservedQuantity: 0, unit: 'pizza', status: 'available', createdAt: nowIso(now) },
      { id: 'item-ketchup-a', name: 'Ketchup', owner: 'Bri', totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0, unit: 'bottle', status: 'available', createdAt: nowIso(now) },
      { id: 'item-ketchup-b', name: 'Ketchup', owner: 'Casey', totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0, unit: 'bottle', status: 'available', createdAt: nowIso(now) },
    ],
    requests: [],
    activities: [{ id: 'activity-demo', type: 'system', text: 'Demo fridge loaded with sample items.', createdAt: nowIso(now) }],
  }
}

export function validateQuantity(value, label = 'Quantity') {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${label} must be greater than zero.`)
  return roundQuantity(quantity)
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}

function updateItem(state, itemId, updater) {
  return { ...state, items: state.items.map((item) => item.id === itemId ? updater(item) : item) }
}

function addActivity(state, text, now) {
  return { ...state, activities: [{ id: makeId('activity'), text, type: 'event', createdAt: nowIso(now) }, ...state.activities] }
}

function activeReservation(state, itemId) {
  return roundQuantity(state.requests.filter((request) => request.itemId === itemId && ['pending', 'approved'].includes(request.status)).reduce((sum, request) => sum + request.quantity, 0))
}

function setRequestStatus(state, requestId, status) {
  return { ...state, requests: state.requests.map((request) => request.id === requestId ? { ...request, status } : request) }
}

export function processExpirations(state, now = Date.now()) {
  let next = state
  for (const request of state.requests) {
    const expiresAt = request.expiresAt || request.pendingExpiresAt
    if (!['pending', 'approved'].includes(request.status) || !expiresAt || new Date(expiresAt).getTime() > now) continue
    const item = next.items.find((candidate) => candidate.id === request.itemId)
    if (item) {
      next = updateItem(next, request.itemId, (candidate) => {
        const reserved = roundQuantity(Math.max(0, candidate.reservedQuantity - request.quantity))
        return { ...candidate, reservedQuantity: reserved, availableQuantity: candidate.status === 'spoiled' ? 0 : roundQuantity(candidate.totalQuantity - reserved) }
      })
    }
    next = setRequestStatus(next, request.id, 'expired')
    next = addActivity(next, `${request.requester}'s ${request.quantity} ${request.unit} ${request.status} request expired; inventory was released.`, now)
  }
  return next
}

export function executeAction(state, operation, now = Date.now()) {
  const reconciledState = processExpirations(state, now)
  try {
    return { state: operation(reconciledState), error: null }
  } catch (error) {
    return { state: reconciledState, error }
  }
}

export function addFoodItem(state, input, now = Date.now()) {
  const name = requireText(input.name, 'Food name')
  const owner = requireText(input.owner, 'Owner')
  const quantity = validateQuantity(input.quantity, 'Food quantity')
  const unit = typeof input.unit === 'string' && input.unit.trim() ? input.unit.trim() : 'portion'
  const item = { id: makeId('item'), name, owner, totalQuantity: quantity, availableQuantity: quantity, reservedQuantity: 0, unit, status: 'available', createdAt: nowIso(now) }
  return addActivity({ ...state, items: [item, ...state.items] }, `${item.owner} added ${item.name}.`, now)
}

export function requestPortion(state, input, now = Date.now()) {
  let next = processExpirations(state, now)
  const item = next.items.find((candidate) => candidate.id === input.itemId)
  const requester = requireText(input.requester, 'Requester')
  const quantity = validateQuantity(input.quantity, 'Requested quantity')
  if (!item) throw new Error('Food item not found.')
  if (item.status === 'spoiled') throw new Error('Spoiled food cannot be requested.')
  if (quantity > item.availableQuantity) throw new Error(`Not enough available ${item.name}. Only ${item.availableQuantity} ${item.unit} remains.`)
  const request = { id: makeId('request'), itemId: item.id, itemName: item.name, unit: item.unit, requester, quantity, status: 'pending', createdAt: nowIso(now), pendingExpiresAt: nowIso(now + PENDING_TTL_MS), expiresAt: null }
  next = updateItem(next, item.id, (candidate) => {
    const available = roundQuantity(candidate.availableQuantity - quantity)
    const reserved = roundQuantity(candidate.reservedQuantity + quantity)
    return { ...candidate, availableQuantity: available, reservedQuantity: reserved, totalQuantity: roundQuantity(available + reserved) }
  })
  next = { ...next, requests: [request, ...next.requests] }
  return addActivity(next, `${requester} requested ${quantity} ${item.unit} of ${item.name}; reserved immediately pending approval.`, now)
}

export function approveRequest(state, requestId, now = Date.now()) {
  let next = processExpirations(state, now)
  const request = next.requests.find((candidate) => candidate.id === requestId)
  if (!request || request.status !== 'pending') throw new Error('Only pending requests can be approved.')
  next = { ...next, requests: next.requests.map((candidate) => candidate.id === requestId ? { ...candidate, status: 'approved', approvedAt: nowIso(now), expiresAt: nowIso(now + APPROVAL_TTL_MS) } : candidate) }
  return addActivity(next, `${request.requester}'s request for ${request.itemName} was approved for 30 minutes.`, now)
}

function releaseRequest(state, request, status, text, now) {
  let next = updateItem(state, request.itemId, (item) => {
    const reserved = roundQuantity(Math.max(0, item.reservedQuantity - request.quantity))
    return { ...item, reservedQuantity: reserved, availableQuantity: item.status === 'spoiled' ? 0 : roundQuantity(item.totalQuantity - reserved) }
  })
  next = setRequestStatus(next, request.id, status)
  return addActivity(next, text, now)
}

export function rejectRequest(state, requestId, now = Date.now()) {
  const next = processExpirations(state, now)
  const request = next.requests.find((candidate) => candidate.id === requestId)
  if (!request || request.status !== 'pending') throw new Error('Only pending requests can be rejected.')
  return releaseRequest(next, request, 'rejected', `${request.requester}'s request for ${request.itemName} was rejected; inventory was released.`, now)
}

export function consumeRequest(state, requestId, now = Date.now()) {
  let next = processExpirations(state, now)
  const request = next.requests.find((candidate) => candidate.id === requestId)
  const item = request && next.items.find((candidate) => candidate.id === request.itemId)
  if (!request || request.status !== 'approved') throw new Error('Only active approved requests can be consumed.')
  if (!item || item.status === 'spoiled') throw new Error('Spoiled food cannot be consumed.')
  next = updateItem(next, item.id, (candidate) => {
    const total = roundQuantity(Math.max(0, candidate.totalQuantity - request.quantity))
    const reserved = roundQuantity(Math.max(0, candidate.reservedQuantity - request.quantity))
    return { ...candidate, totalQuantity: total, reservedQuantity: reserved, availableQuantity: roundQuantity(total - reserved) }
  })
  next = setRequestStatus(next, request.id, 'consumed')
  return addActivity(next, `${request.requester} consumed ${request.quantity} ${item.unit} of ${item.name}.`, now)
}

export function discardFood(state, itemId, now = Date.now()) {
  let next = processExpirations(state, now)
  const item = next.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error('Food item not found.')
  next = updateItem(next, itemId, (candidate) => ({ ...candidate, status: 'spoiled', totalQuantity: 0, availableQuantity: 0, reservedQuantity: 0 }))
  next = { ...next, requests: next.requests.map((request) => request.itemId === itemId && ['pending', 'approved'].includes(request.status) ? { ...request, status: 'cancelled' } : request) }
  return addActivity(next, `${item.name} (${item.id}) was marked spoiled and discarded; outstanding requests were cancelled.`, now)
}

export function correctInventory(state, input, now = Date.now()) {
  const item = state.items.find((candidate) => candidate.id === input.itemId)
  if (!item) throw new Error('Food item not found.')
  if (item.status === 'spoiled') throw new Error('Spoiled food cannot be corrected.')
  let next = processExpirations(state, now)
  const actual = Number(input.actualQuantity)
  if (!Number.isFinite(actual) || actual < 0) throw new Error('Actual quantity must be zero or greater.')
  const physicalQuantity = roundQuantity(actual)
  const reserved = activeReservation(next, item.id)
  if (physicalQuantity < reserved) throw new Error(`Correction cannot be below ${reserved} reserved ${item.unit}.`)
  next = updateItem(next, item.id, (candidate) => ({ ...candidate, totalQuantity: physicalQuantity, availableQuantity: roundQuantity(physicalQuantity - reserved), reservedQuantity: reserved }))
  return addActivity(next, `Inventory corrected for ${item.name} (${item.id}) to ${physicalQuantity} ${item.unit}. Reason: ${requireText(input.reason, 'Correction reason')}.`, now)
}
