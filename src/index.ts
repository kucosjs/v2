import { createApp } from './app.js'
import { readConfig } from './config.js'
import { openDatabase } from './database.js'

export const config = readConfig()
export const database = openDatabase()
export default createApp({ database, config })
