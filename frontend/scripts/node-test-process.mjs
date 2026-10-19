import {spawnSync} from 'node:child_process'

export function runNodeTestProcess(args, options = {}) {
  const env = {...process.env, ...options.env}
  // A child CLI must own its result, rather than emit the parent runner's private protocol.
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, args, {...options, env})
}
