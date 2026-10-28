import { useEffect, useRef, useState } from 'react'
import { addFoodItem, approveRequest, consumeRequest, correctInventory, createDemoState, discardFood, executeAction, processExpirations, rejectRequest, requestPortion } from './domain/fridge'

const STORAGE_KEY = 'fridgepolice-state'
const readState = () => { try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? processExpirations(JSON.parse(saved)) : createDemoState() } catch { return createDemoState() } }
const formatQty = (value) => Number(value.toFixed(2)).toString()
const formatDate = (date) => new Date(date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function App() {
  const [state, setState] = useState(readState)
  const stateRef = useRef(state)
  const [notice, setNotice] = useState({ type: '', text: '' })
  const [foodForm, setFoodForm] = useState({ name: '', owner: 'Alex', quantity: '', unit: 'portion' })
  const [requestForm, setRequestForm] = useState({})
  const [correction, setCorrection] = useState({})

  useEffect(() => { stateRef.current = state; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }, [state])
  useEffect(() => {
    const timer = setInterval(() => setState((current) => {
      const next = processExpirations(current)
      stateRef.current = next
      return next
    }), 30000)
    return () => clearInterval(timer)
  }, [])

  const run = (operation) => {
    const result = executeAction(stateRef.current, operation)
    if (!result.error) {
      const next = result.state
      stateRef.current = next
      setState(next)
      setNotice({ type: 'success', text: 'Action completed.' })
      return true
    }
    if (result.state !== stateRef.current) {
      stateRef.current = result.state
      setState(result.state)
    }
    setNotice({ type: 'error', text: result.error instanceof Error ? result.error.message : 'Action failed.' })
    return false
  }
  const pendingCount = state.requests.filter((request) => request.status === 'pending').length
  const reserved = state.items.reduce((sum, item) => sum + item.reservedQuantity, 0)
  const available = state.items.reduce((sum, item) => sum + item.availableQuantity, 0)

  const reset = () => { const next = createDemoState(); stateRef.current = next; setState(next); setNotice({ type: 'success', text: 'Demo data reset.' }) }
  const submitFood = (event) => { event.preventDefault(); if (run((current) => addFoodItem(current, foodForm))) setFoodForm({ ...foodForm, name: '', quantity: '' }) }
  const submitRequest = (event, itemId) => { event.preventDefault(); run((current) => requestPortion(current, { itemId, requester: requestForm[itemId]?.requester || 'Bri', quantity: requestForm[itemId]?.quantity })) }
  const submitCorrection = (event) => { event.preventDefault(); if (run((current) => correctInventory(current, correction))) setCorrection({}) }

  return <div className="app-shell">
    <header className="hero">
      <div><p className="eyebrow">SHARED FRIDGE COMMAND CENTER</p><h1>Fridge<span>Police</span></h1><p className="subtitle">Fair portions. Clear ownership. No mystery leftovers.</p></div>
      <button className="button secondary" onClick={reset}>↻ Reset demo data</button>
    </header>
    <main>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice({ type: '', text: '' })}>×</button></div>}
      <section className="stats"><div><span>Available portions</span><strong>{formatQty(available)}</strong></div><div><span>Reserved portions</span><strong>{formatQty(reserved)}</strong></div><div><span>Pending requests</span><strong>{pendingCount}</strong></div><div><span>Roommates</span><strong>{state.roommates.length}</strong></div></section>
      <div className="layout">
        <section className="panel inventory-panel"><div className="section-heading"><div><p className="eyebrow">LIVE INVENTORY</p><h2>Food in the fridge</h2></div><span className="badge">{state.items.length} items</span></div>
          <div className="inventory-grid">{state.items.map((item) => <article className={`food-card ${item.status}`} key={item.id}>
            <div className="food-top"><div className="food-icon">{item.name.slice(0, 1).toUpperCase()}</div><div><h3>{item.name}</h3><p>Owned by {item.owner} · <code>{item.id}</code></p></div><span className={`status ${item.status}`}>{item.status}</span></div>
            <div className="quantity-row"><div><small>AVAILABLE</small><b>{formatQty(item.availableQuantity)} <em>{item.unit}</em></b></div><div><small>RESERVED</small><b>{formatQty(item.reservedQuantity)} <em>{item.unit}</em></b></div><div><small>TOTAL</small><b>{formatQty(item.totalQuantity)} <em>{item.unit}</em></b></div></div>
            {item.status === 'available' && <><form className="inline-form" onSubmit={(event) => submitRequest(event, item.id)}><select value={requestForm[item.id]?.requester || 'Bri'} onChange={(event) => setRequestForm({ ...requestForm, [item.id]: { ...requestForm[item.id], requester: event.target.value } })}>{state.roommates.map((roommate) => <option key={roommate}>{roommate}</option>)}</select><input type="number" min="0.01" step="0.01" placeholder="Qty" value={requestForm[item.id]?.quantity || ''} onChange={(event) => setRequestForm({ ...requestForm, [item.id]: { ...requestForm[item.id], quantity: event.target.value } })} /><button className="button primary">Request portion</button></form><button className="text-button danger-text" onClick={() => run((current) => discardFood(current, item.id))}>Mark spoiled / discard</button></>}
            {item.status === 'spoiled' && <p className="muted">Discarded food cannot be requested or consumed.</p>}
          </article>)}</div>
        </section>
        <aside className="side-column">
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">NEW ITEM</p><h2>Add food</h2></div></div><form className="stack-form" onSubmit={submitFood}><label>Food name<input required value={foodForm.name} onChange={(event) => setFoodForm({ ...foodForm, name: event.target.value })} placeholder="e.g. Cereal" /></label><div className="two-col"><label>Owner<select value={foodForm.owner} onChange={(event) => setFoodForm({ ...foodForm, owner: event.target.value })}>{state.roommates.map((roommate) => <option key={roommate}>{roommate}</option>)}</select></label><label>Quantity<input required type="number" min="0.01" step="0.01" value={foodForm.quantity} onChange={(event) => setFoodForm({ ...foodForm, quantity: event.target.value })} /></label></div><label>Unit<input value={foodForm.unit} onChange={(event) => setFoodForm({ ...foodForm, unit: event.target.value })} /></label><button className="button primary">Add to fridge</button></form></section>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">PHYSICAL CHECK</p><h2>Correct inventory</h2></div></div><form className="stack-form" onSubmit={submitCorrection}><label>Exact item<select required value={correction.itemId || ''} onChange={(event) => setCorrection({ ...correction, itemId: event.target.value })}><option value="">Select an item...</option>{state.items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.owner} · {item.id}</option>)}</select></label><label>Actual quantity remaining<input required type="number" min="0" step="0.01" value={correction.actualQuantity || ''} onChange={(event) => setCorrection({ ...correction, actualQuantity: event.target.value })} /></label><label>Reason<select value={correction.reason || 'eaten without recording'} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })}><option>eaten without recording</option><option>missing</option><option>manual correction</option></select></label><button className="button outline">Save correction</button></form><p className="helper">Reservations are protected: the physical count cannot be set below portions already promised.</p></section>
        </aside>
      </div>
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">WORK QUEUE</p><h2>Request history</h2></div><span className="helper">Pending requests expire after 24 hours · approvals after 30 minutes</span></div><div className="request-list">{state.requests.length === 0 ? <p className="empty">No requests yet. Request a portion above to start the demo.</p> : state.requests.map((request) => <div className="request-row" key={request.id}><div><strong>{request.itemName}</strong><span>{request.requester} requested {formatQty(request.quantity)} {request.unit}</span><small>{request.status === 'approved' && `Expires ${formatDate(request.expiresAt)}`}</small></div><span className={`status ${request.status}`}>{request.status}</span><div className="request-actions">{request.status === 'pending' && <><button className="button small primary" onClick={() => run((current) => approveRequest(current, request.id))}>Approve</button><button className="button small subtle" onClick={() => run((current) => rejectRequest(current, request.id))}>Reject</button></>}{request.status === 'approved' && <button className="button small primary" onClick={() => run((current) => consumeRequest(current, request.id))}>Consume</button>}</div></div>)}</div></section>
      <section className="panel activity"><div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Activity history</h2></div></div>{state.activities.slice(0, 8).map((activity) => <div className="activity-row" key={activity.id}><span className="activity-dot"></span><p>{activity.text}<small>{formatDate(activity.createdAt)}</small></p></div>)}</section>
    </main>
    <footer>FridgePolice · Local-only demo data · Requests reserve immediately to prevent double allocation</footer>
  </div>
}

export default App
