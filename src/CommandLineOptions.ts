import { Command } from 'commander'
// eslint-disable-next-line id-length
import ts from 'typescript'

import packageJson from '../package.json'

import * as scip from './scip'

/** Configuration options to index a multi-project workspace. */
export interface MultiProjectOptions {
  inferTsconfig: boolean
  progressBar: boolean
  yarnWorkspaces: boolean
  yarnBerryWorkspaces: boolean
  pnpmWorkspaces: boolean
  globalCaches: boolean
  cwd: string
  output: string
  indexedProjects: Set<string>
}

/** Configuration options to index a single TypeScript project. */
export interface ProjectOptions extends MultiProjectOptions {
  projectRoot: string
  projectDisplayName: string
  writeIndex: (index: scip.scip.Index) => void
}

/** Cached values */
export interface GlobalCache {
  sources: Map<
    string,
    [ts.SourceFile | undefined, ts.ScriptTarget | ts.CreateSourceFileOptions]
  >
  parsedCommandLines: Map<string, ts.ParsedCommandLine>
}

export function mainCommand(
  indexAction: (projects: string[], otpions: MultiProjectOptions) => void
): Command {
  const command = new Command()
  command
    .name('scip-typescript')
    .version(packageJson.version)
    .description(
      'SCIP indexer for TypeScript and JavaScript\nFor usage examples, see https://github.com/sourcegraph/scip-typescript/blob/main/README.md'
    )
  command
    .command('index')
    .option('--cwd <path>', 'the working directory', process.cwd())
    .option('--pnpm-workspaces', 'whether to index all pnpm workspaces', false)
    .option('--yarn-workspaces', 'whether to index all yarn workspaces', false)
    .option(
      '--yarn-berry-workspaces',
      '(deprecated) use --yarn-workspaces instead',
      false
    )
    .option(
      '--infer-tsconfig',
      "whether to infer the tsconfig.json file, if it's missing",
      false
    )
    .option('--output <path>', 'path to the output file', 'index.scip')
    .option('--progress-bar', 'whether to enable a rich progress bar')
    .option('--no-progress-bar', 'whether to disable the rich progress bar')
    .option(
      '--no-global-caches',
      'whether to disable global caches between TypeScript projects'
    )
    .argument('[projects...]')
    .action((parsedProjects, parsedOptions) => {
      indexAction(
        parsedProjects as string[],
        parsedOptions as MultiProjectOptions
      )
    })
  return command
}
