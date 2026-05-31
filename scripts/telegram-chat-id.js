import { readFile } from 'node:fs/promises'

const ENV_FILE = new URL('../.env', import.meta.url)

async function loadEnvFile() {
  let content

  try {
    content = await readFile(ENV_FILE, 'utf8')
  } catch {
    return
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) {
      continue
    }

    const [rawKey, ...rawValueParts] = trimmedLine.split('=')
    const key = rawKey.trim()
    const value = rawValueParts.join('=').trim().replace(/^["']|["']$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

async function main() {
  await loadEnvFile()

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.telegram_bot_token

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in .env')
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
  const data = await response.json()

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram getUpdates failed: ${JSON.stringify(data, null, 2)}`,
    )
  }

  const chats = new Map()

  for (const update of data.result) {
    const chat = update.message?.chat ?? update.channel_post?.chat

    if (chat?.id) {
      chats.set(chat.id, chat)
    }
  }

  if (chats.size === 0) {
    console.log('No chat id found yet.')
    console.log('Open Telegram, send any message to your bot, then run this again.')
    return
  }

  console.log('Available Telegram chat ids:')

  for (const chat of chats.values()) {
    const name = chat.title || chat.username || [chat.first_name, chat.last_name]
      .filter(Boolean)
      .join(' ')

    console.log(`- ${chat.id} (${chat.type}${name ? `, ${name}` : ''})`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
