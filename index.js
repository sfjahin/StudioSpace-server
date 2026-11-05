import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import 'dotenv/config'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT ?? 8000
const DB_NAME = process.env.MONGODB_DB ?? 'studiospace'
const COLLECTION = 'studios'

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
      hostName: str(body.hostName),
      hostEmail: str(body.hostEmail),
    },
  }
}

function toClient(doc) {
  const { _id, ...rest } = doc
  return { id: _id.toString(), ...rest }
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

app.get('/studios', async (_req, res) => {
  try {
    const docs = await studios().find().sort({ createdAt: -1 }).toArray()
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
 * Host info is read-only: whatever host the document already has is kept.
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

  // Strip host fields so a client can never reassign the listing's host.
  const { hostName: _hostName, hostEmail: _hostEmail, ...editable } = value

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
