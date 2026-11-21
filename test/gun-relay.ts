import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../prisma-gun/relay.js', import.meta.url))

export async function startGunRelay(directory: string) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      GUN_HOST: '127.0.0.1',
      GUN_PORT: '0',
      GUN_DATA_DIR: join(directory, 'relay'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })
  const url = new Promise<string>((resolve) => {
    lines.on('line', (line) => {
      const prefix = 'Gun relay listening on '
      if (line.startsWith(prefix)) resolve(line.slice(prefix.length))
    })
  })
  let timeout: ReturnType<typeof setTimeout> | undefined

  async function close() {
    child.kill('SIGTERM')
    await exited
  }

  try {
    const peer = await Promise.race([
      url,
      exited.then(([code]) => {
        throw new Error(`Gun relay exited with code ${code}.`)
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Gun relay startup timed out.')), 5000)
      }),
    ])
    return { peer, close }
  } catch (error) {
    await close()
    throw error
  } finally {
    clearTimeout(timeout)
    lines.close()
    child.stdout.resume()
  }
}
