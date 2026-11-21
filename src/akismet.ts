import { AkismetClient } from 'akismet-api'
import type { Config } from './config.js'

export type SpamInput = {
  article: string
  content: string
  author: string
  email: string | null
  website: string | null
  ip: string | null
  userAgent: string | null
  createdAt: Date
}

type Feedback = 'submit-spam' | 'submit-ham'
export type Akismet = {
  enabled: boolean
  check(input: SpamInput): Promise<boolean>
  feedback(input: SpamInput, decision: Feedback): Promise<void>
}

async function deadline<T>(request: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Akismet did not respond in time.')), 4000)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function createAkismet(config: Config): Akismet {
  const key = config.akismetKey
  if (key && !/^[a-z\d]+$/i.test(key)) throw new Error('AKISMET_API_KEY must be alphanumeric.')

  function request(input: SpamInput) {
    if (!key || !input.ip) throw new Error('Akismet requires a key and the original submitter IP.')
    return {
      client: new AkismetClient({
        key,
        blog: new URL(input.article).origin,
        charset: 'UTF-8',
        userAgent: 'Kucos/2.0',
      }),
      comment: {
        ip: input.ip,
        useragent: input.userAgent ?? undefined,
        name: input.author,
        content: input.content,
        email: input.email ?? undefined,
        url: input.website ?? undefined,
        permalink: input.article,
        date: input.createdAt.toISOString(),
        type: 'comment',
        isTest: config.akismetTesting,
      },
    }
  }

  return {
    enabled: Boolean(key),
    async check(input) {
      if (!key) return false
      const { client, comment } = request(input)
      return await deadline(client.checkSpam(comment))
    },
    async feedback(input, decision) {
      if (!key) return
      const { client, comment } = request(input)
      await deadline(
        decision === 'submit-spam' ? client.submitSpam(comment) : client.submitHam(comment),
      )
    },
  }
}
