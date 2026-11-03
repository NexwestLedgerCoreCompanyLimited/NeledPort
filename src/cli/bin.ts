import { run } from './main'

// exitCode, not exit(): answers still on their way (an MCP reply after stdin closed) get written first.
run(process.argv.slice(2)).then((code) => (process.exitCode = code))
