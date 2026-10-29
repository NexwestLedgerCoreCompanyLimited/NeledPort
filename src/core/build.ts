import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Build id SteamCMD recorded for the installed server, if any. */
export function installedBuild(installDir: string, appId: number): string | undefined {
  const file = join(installDir, 'steamapps', `appmanifest_${appId}.acf`)
  if (!existsSync(file)) return undefined
  return /"buildid"\s+"(\d+)"/.exec(readFileSync(file, 'utf8'))?.[1]
}

/** Latest public build id from `steamcmd +app_info_print <appid>` output. */
export function parseLatestBuild(appInfo: string): string | undefined {
  const branches = appInfo.indexOf('"branches"')
  if (branches < 0) return undefined
  const publicBranch = appInfo.indexOf('"public"', branches)
  if (publicBranch < 0) return undefined
  return /"buildid"\s+"(\d+)"/.exec(appInfo.slice(publicBranch))?.[1]
}

export function appInfoArgs(appId: number): string[] {
  return ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', String(appId), '+quit']
}
