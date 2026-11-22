import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import mongoose from 'mongoose'

const commentSchema = new mongoose.Schema(
  {
    article_id: String,
    author: String,
    comment: String,
    email: String,
    website: String,
    likes: Number,
    dislikes: Number,
    parent_id: mongoose.Schema.Types.ObjectId,
    createdOn: Date,
    updatedOn: Date,
    userid: String,
    spam: Number,
    sticky: Number,
  },
  { collection: 'comments' },
)

const voteSchema = new mongoose.Schema(
  {
    msgid: String,
    userid: String,
  },
  { collection: 'votes' },
)

const spamSchema = new mongoose.Schema(
  {
    comment_id: String,
  },
  { collection: 'spams' },
)

const kudoSchema = new mongoose.Schema(
  {
    kudos: Number,
    article_id: String,
  },
  { collection: 'kudos' },
)

const Comment = mongoose.model('Comment', commentSchema)
const Vote = mongoose.model('Vote', voteSchema)
const Spam = mongoose.model('Spam', spamSchema)
const Kudo = mongoose.model('Kudo', kudoSchema)

async function exportToJson(mongoUrl: string, outDir: string) {
  console.log('Connecting to MongoDB...')
  await mongoose.connect(mongoUrl)
  console.log('Connected. Fetching data...')

  const [comments, votes, spams, kudos] = await Promise.all([
    Comment.find().lean(),
    Vote.find().lean(),
    Spam.find().lean(),
    Kudo.find().lean(),
  ])

  console.log(
    `Fetched ${comments.length} comments, ${votes.length} votes, ${spams.length} spams, ${kudos.length} kudos`,
  )

  await mkdir(outDir, { recursive: true })

  const collections = [
    { name: 'comments', data: comments },
    { name: 'votes', data: votes },
    { name: 'spams', data: spams },
    { name: 'kudos', data: kudos },
  ]

  for (const { name, data } of collections) {
    const path = join(outDir, `${name}.json`)
    await writeFile(path, JSON.stringify(data, null, 2))
    console.log(`Wrote ${data.length} records to ${path}`)
  }

  await mongoose.disconnect()
  console.log('Done.')
}

const mongoUrl = process.argv[2] || process.env.MONGODB_URI
const outDir = process.argv[3] || './mongo-export'

try {
  if (!mongoUrl) throw new Error('Usage: npm run db:export:mongo -- <mongodb+srv://...> [output-dir]')
  if (!mongoUrl.startsWith('mongodb')) throw new Error('Expected a mongodb:// or mongodb+srv:// connection string.')
  await exportToJson(mongoUrl, outDir)
} catch (error) {
  console.error(error instanceof Error && error.name === 'Error' ? error.message : 'MongoDB export failed.')
  process.exitCode = 1
}
