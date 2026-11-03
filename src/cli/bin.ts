import { run } from './main'

run(process.argv.slice(2)).then((code) => process.exit(code))
