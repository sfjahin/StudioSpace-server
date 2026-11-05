import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import 'dotenv/config'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT ?? 8000
const DB_NAME = process.env.MONGODB_DB ?? 'studiospace'
const COLLECTION = 'studios'
const BOOKINGS = 'bookings'

const CATEGORIES = new Set([
  'Photo Studio',
  'Film Stage',
  'Podcast Lounge',
  'Music Suite',
  'Workshop',
  'Dance Studio',
  'Art & Making',
  'Other',
])

app.use(cors())
app.use(express.json())

const client = new MongoClient(process.env.MONGODB_URI)

export async function connectToMongoDB() {
  await client.connect()
  console.log('You successfully connected to MongoDB!')
  return client
}

function studios() {
  return client.db(DB_NAME).collection(COLLECTION)
}

function bookings() {
  return client.db(DB_NAME).collection(BOOKINGS)
}

/**
 * Validate an incoming studio payload.
 * Returns { fields, value } — `fields` is empty when the payload is valid.
 */
function validateStudio(body = {}) {
  const fields = {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const num = (v) => (typeof v === 'number' ? v : Number.parseFloat(v))

  const title = str(body.title)
  const category = str(body.category)
  const address = str(body.address)
  const imageUrl = str(body.imageUrl)
  const overview = str(body.overview)
  const hourlyRate = num(body.hourlyRate)
  const securityDeposit = num(body.securityDeposit)
  const maxCapacity = num(body.maxCapacity)
  const amenities = Array.isArray(body.amenities)
    ? body.amenities.filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
    : []

  if (!title) fields.title = 'Give your studio a name.'
  else if (title.length > 60) fields.title = 'Keep the name under 60 characters.'

  if (!category) fields.category = 'Choose a category.'
  else if (!CATEGORIES.has(category)) fields.category = 'Choose a valid category.'

  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    fields.hourlyRate = 'Enter an hourly rate above $0.'
  }

  if (!Number.isFinite(securityDeposit) || securityDeposit < 0) {
    fields.securityDeposit = 'Enter a deposit (use 0 for none).'
  }

  if (!Number.isInteger(maxCapacity) || maxCapacity <= 0) {
    fields.maxCapacity = 'Enter how many people fit.'
  }

  if (!address) fields.address = "Add the studio's address."

  if (!/^https?:\/\/.+/i.test(imageUrl)) {
    fields.imageUrl = 'Paste a full image link starting with http:// or https://.'
  }

  if (overview.length < 40) {
    fields.overview = 'Write at least 40 characters about the light, layout and equipment.'
  }

  return {
    fields,
    value: {
      title,
      category,
      hourlyRate,
      securityDeposit,
      maxCapacity,
      address,
      imageUrl,
      amenities,
      overview,
      ownerName: str(body.ownerName ?? body.hostName),
      ownerEmail: str(body.ownerEmail ?? body.hostEmail),
    },
  }
}

function toClient(doc) {
  const { _id, hostName, hostEmail, ...rest } = doc
  const out = { id: _id.toString(), ...rest }
  // Listings created before the rename stored the owner as hostName / hostEmail.
  if (!out.ownerName && hostName) out.ownerName = hostName
  if (!out.ownerEmail && hostEmail) out.ownerEmail = hostEmail
  return out
}

/** Case-insensitive exact-match regex for an email address. */
function emailMatcher(email) {
  const escaped = String(email).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped + '$', 'i')
}

app.post('/add-studio', async (req, res) => {
  const { fields, value } = validateStudio(req.body)

  if (Object.keys(fields).length > 0) {
    return res.status(400).json({
      message: 'Some fields need attention.',
      fields,
    })
  }

  try {
    const doc = { ...value, createdAt: new Date() }
    const result = await studios().insertOne(doc)
    return res.status(201).json(toClient({ _id: result.insertedId, ...doc }))
  } catch (err) {
    console.error('Failed to insert studio:', err)
    return res.status(500).json({ message: "We couldn't save your studio. Please try again." })
  }
})

app.get('/studios', async (req, res) => {
  try {
    // Optional ?ownerEmail= filter powers the "My Listings" page.
    const ownerEmail = typeof req.query.ownerEmail === 'string' ? req.query.ownerEmail.trim() : ''
    const filter = ownerEmail
      ? { $or: [{ ownerEmail: emailMatcher(ownerEmail) }, { hostEmail: emailMatcher(ownerEmail) }] }
      : {}
    const docs = await studios().find(filter).sort({ createdAt: -1 }).toArray()
    return res.json({ studios: docs.map(toClient) })
  } catch (err) {
    console.error('Failed to list studios:', err)
    return res.status(500).json({ message: "We couldn't load studios. Please try again." })
  }
})

app.get('/studios/:id', async (req, res) => {
  const { id } = req.params

  if (!ObjectId.isValid(id)) {
    return res.status(404).json({ message: 'Studio not found.' })
  }

  try {
    const doc = await studios().findOne({ _id: new ObjectId(id) })
    if (!doc) return res.status(404).json({ message: 'Studio not found.' })
    return res.json(toClient(doc))
  } catch (err) {
    console.error('Failed to load studio:', err)
    return res.status(500).json({ message: "We couldn't load that studio. Please try again." })
  }
})

/**
 * Update an existing studio (PUT / PATCH /studios/:id).
 * Owner info is read-only: whatever owner the document already has is kept.
 */
async function updateStudio(req, res) {
  const { id } = req.params

  if (!ObjectId.isValid(id)) {
    return res.status(404).json({ message: 'Studio not found.' })
  }

  const { fields, value } = validateStudio(req.body)

  if (Object.keys(fields).length > 0) {
    return res.status(400).json({
      message: 'Some fields need attention.',
      fields,
    })
  }

  // Strip owner fields so a client can never reassign the listing's owner.
  const { ownerName: _ownerName, ownerEmail: _ownerEmail, ...editable } = value

  try {
    const doc = await studios().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...editable, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!doc) return res.status(404).json({ message: 'Studio not found.' })
    return res.json(toClient(doc))
  } catch (err) {
    console.error('Failed to update studio:', err)
    return res.status(500).json({ message: "We couldn't save your changes. Please try again." })
  }
}

app.put('/studios/:id', updateStudio)
app.patch('/studios/:id', updateStudio)

/** Delete a listing permanently. */
app.delete('/studios/:id', async (req, res) => {
  const { id } = req.params

  if (!ObjectId.isValid(id)) {
    return res.status(404).json({ message: 'Studio not found.' })
  }

  try {
    const result = await studios().deleteOne({ _id: new ObjectId(id) })

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Studio not found.' })
    }

    return res.json({ id, deleted: true })
  } catch (err) {
    console.error('Failed to delete studio:', err)
    return res.status(500).json({ message: "We couldn't delete that studio. Please try again." })
  }
})

/* -------------------------------------------------------------------------- */
/*                                  Bookings                                  */
/* -------------------------------------------------------------------------- */

const SERVICE_FEE_RATE = 0.1 // keep in sync with the client (src/lib/api.ts)
const MIN_HOURS = 2 // same 2-hour minimum the booking card bills for

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME_RE = /^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/
const round2 = (n) => Math.round(n * 100) / 100

/** "02:00 PM" -> minutes since midnight. */
function toMinutes(time) {
  const [hm, period] = time.split(' ')
  const [h, m] = hm.split(':').map(Number)
  const hour24 = period === 'PM' && h !== 12 ? h + 12 : period === 'AM' && h === 12 ? 0 : h
  return hour24 * 60 + m
}

/**
 * Validate a booking request against the studio it targets.
 * Prices are always recomputed here from the studio's hourly rate, never trusted from the client.
 */
function validateBooking(body = {}, studio) {
  const fields = {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const userName = str(body.userName)
  const userEmail = str(body.userEmail).toLowerCase()
  const date = str(body.date)
  const startTime = str(body.startTime)
  const endTime = str(body.endTime)
  const note = str(body.note)
  const crewSize = Number(body.crewSize)

  if (!userName) fields.userName = 'Tell the host who is booking.'
  if (!EMAIL_RE.test(userEmail)) fields.userEmail = 'Enter a valid email address.'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    fields.date = 'Pick a date for your session.'
  }

  let hours = 0
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    fields.startTime = 'Choose a start and end time.'
  } else {
    const raw = (toMinutes(endTime) - toMinutes(startTime)) / 60
    if (raw <= 0) fields.endTime = 'End time must be after the start time.'
    hours = Math.max(raw, MIN_HOURS)
  }

  if (!Number.isInteger(crewSize) || crewSize < 1 || crewSize > studio.maxCapacity) {
    fields.crewSize = `Crew size must be between 1 and ${studio.maxCapacity}.`
  }

  if (note.length > 500) fields.note = 'Keep the note under 500 characters.'

  const subtotal = round2(studio.hourlyRate * hours)
  const serviceFee = round2(subtotal * SERVICE_FEE_RATE)

  return {
    fields,
    value: {
      userName,
      userEmail,
      date,
      startTime,
      endTime,
      hours,
      crewSize,
      note,
      hourlyRate: studio.hourlyRate,
      subtotal,
      serviceFee,
      total: round2(subtotal + serviceFee),
    },
  }
}

/** Create a booking. It always starts as "Pending". */
app.post('/bookings', async (req, res) => {
  const { studioId } = req.body ?? {}

  if (typeof studioId !== 'string' || !ObjectId.isValid(studioId)) {
    return res.status(404).json({ message: 'Studio not found.' })
  }

  try {
    const studioDoc = await studios().findOne({ _id: new ObjectId(studioId) })
    if (!studioDoc) return res.status(404).json({ message: 'Studio not found.' })
    const studio = toClient(studioDoc)

    const { fields, value } = validateBooking(req.body, studio)
    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ message: 'Some fields need attention.', fields })
    }

    const doc = {
      studioId,
      studioTitle: studio.title,
      studioImage: studio.imageUrl,
      studioAddress: studio.address,
      studioCategory: studio.category,
      ownerEmail: studio.ownerEmail ?? '',
      ...value,
      status: 'Pending',
      createdAt: new Date(),
    }
    const result = await bookings().insertOne(doc)
    return res.status(201).json(toClient({ _id: result.insertedId, ...doc }))
  } catch (err) {
    console.error('Failed to create booking:', err)
    return res.status(500).json({ message: "We couldn't save your booking. Please try again." })
  }
})

/** List the bookings made by one user: GET /bookings?email=... */
app.get('/bookings', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : ''
  if (!email) return res.status(400).json({ message: 'An email is required.' })

  try {
    const docs = await bookings()
      .find({ userEmail: emailMatcher(email) })
      .sort({ createdAt: -1 })
      .toArray()
    return res.json({ bookings: docs.map(toClient) })
  } catch (err) {
    console.error('Failed to list bookings:', err)
    return res.status(500).json({ message: "We couldn't load your bookings. Please try again." })
  }
})

/** Cancel a booking. Only the person who booked it can do this, and only while it is Pending. */
app.patch('/bookings/:id/cancel', async (req, res) => {
  const { id } = req.params
  const email = typeof req.body?.userEmail === 'string' ? req.body.userEmail.trim() : ''

  if (!ObjectId.isValid(id)) return res.status(404).json({ message: 'Booking not found.' })

  try {
    const existing = await bookings().findOne({ _id: new ObjectId(id) })
    if (!existing) return res.status(404).json({ message: 'Booking not found.' })

    if (!email || existing.userEmail.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ message: 'You can only cancel your own bookings.' })
    }

    // The status filter makes this atomic: a booking confirmed a moment ago won't be cancelled.
    const updated = await bookings().findOneAndUpdate(
      { _id: existing._id, status: 'Pending' },
      { $set: { status: 'Cancelled', cancelledAt: new Date() } },
      { returnDocument: 'after' }
    )
    if (!updated) {
      return res.status(409).json({ message: 'Only pending bookings can be cancelled.' })
    }
    return res.json(toClient(updated))
  } catch (err) {
    console.error('Failed to cancel booking:', err)
    return res.status(500).json({ message: "We couldn't cancel that booking. Please try again." })
  }
})

app.get('/', (_req, res) => {
  res.send({ message: 'Server is running!' })
})

async function start() {
  try {
    await connectToMongoDB()
  } catch (err) {
    console.error('Could not connect to MongoDB. Fix MONGODB_URI and restart.', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`)
  })
}

start()
