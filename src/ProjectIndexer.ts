import * as path from 'path'

import prettyMilliseconds from 'pretty-ms'
import ProgressBar from 'progress'
import * as ts from 'typescript'

import { GlobalCache, ProjectOptions } from './CommandLineOptions'
import { FileIndexer } from './FileIndexer'
import { Input } from './Input'
import { Packages } from './Packages'
import * as scip from './scip'
import { ScipSymbol } from './ScipSymbol'

function createCompilerHost(
  cache: GlobalCache,
  compilerOptions: ts.CompilerOptions,
  projectOptions: ProjectOptions
): ts.CompilerHost {
  const host = ts.createCompilerHost(compilerOptions)
  if (!projectOptions.globalCaches) {
    return host
  }
  const hostCopy = { ...host }
  host.getParsedCommandLine = (fileName: string) => {
    if (!hostCopy.getParsedCommandLine) {
      return undefined
    }
    const fromCache = cache.parsedCommandLines.get(fileName)
    if (fromCache !== undefined) {
      return fromCache
    }
    const result = hostCopy.getParsedCommandLine(fileName)
    if (result !== undefined) {
      // Don't cache undefined results even if they could be cached
      // theoretically. The big performance gains from this cache come from
      // caching non-undefined results.
      cache.parsedCommandLines.set(fileName, result)
    }
    return result
  }
  host.getSourceFile = (
    fileName,
    languageVersion,
    onError,
    shouldCreateNewSourceFile
  ) => {
    const fromCache = cache.sources.get(fileName)
    if (fromCache !== undefined) {
      const [sourceFile, cachedLanguageVersion] = fromCache
      if (isSameLanguageVersion(languageVersion, cachedLanguageVersion)) {
        return sourceFile
      }
    }
    const result = hostCopy.getSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile
    )
    if (result !== undefined) {
      // Don't cache undefined results even if they could be cached
      // theoretically. The big performance gains from this cache come from
      // caching non-undefined results.
      cache.sources.set(fileName, [result, languageVersion])
    }
    return result
  }
  return host
}

export class ProjectIndexer {
  private program: ts.Program
  private checker: ts.TypeChecker
  private symbolCache: Map<ts.Node, ScipSymbol> = new Map()
  private packages: Packages
  constructor(
    public readonly config: ts.ParsedCommandLine,
    public readonly options: ProjectOptions,
    cache: GlobalCache
  ) {
    const host = createCompilerHost(cache, config.options, options)
    this.program = ts.createProgram(config.fileNames, config.options, host)
    this.checker = this.program.getTypeChecker()
    this.packages = new Packages(options.projectRoot)
  }
  public index(): void {
    const startTimestamp = Date.now()
    const sourceFiles = this.program.getSourceFiles()

    const filesToIndex: ts.SourceFile[] = []
    // Visit every sourceFile in the program
    for (const sourceFile of sourceFiles) {
      const includes = this.config.fileNames.includes(sourceFile.fileName)
      if (!includes) {
        continue
      }
      filesToIndex.push(sourceFile)
    }

    if (filesToIndex.length === 0) {
      throw new Error(
        `no indexable files in project '${this.options.projectDisplayName}'`
      )
    }

    const jobs: ProgressBar | undefined = !this.options.progressBar
      ? undefined
      : new ProgressBar(
          `  ${this.options.projectDisplayName} [:bar] :current/:total :title`,
          {
            total: filesToIndex.length,
            renderThrottle: 100,
            incomplete: '_',
            complete: '#',
            width: 20,
            clear: true,
            stream: process.stderr,
          }
        )
    let lastWrite = startTimestamp
    for (const [index, sourceFile] of filesToIndex.entries()) {
      const title = path.relative(this.options.cwd, sourceFile.fileName)
      jobs?.tick({ title })
      if (!this.options.progressBar) {
        const now = Date.now()
        const elapsed = now - lastWrite
        if (elapsed > 1000 && index > 2) {
          lastWrite = now
          process.stdout.write('.')
        }
      }
      const document = new scip.scip.Document({
        relative_path: path.relative(this.options.cwd, sourceFile.fileName),
        occurrences: [],
      })
      const input = new Input(sourceFile.fileName, sourceFile.getText())
      const visitor = new FileIndexer(
        this.checker,
        this.options,
        input,
        document,
        this.symbolCache,
        this.packages,
        sourceFile
      )
      try {
        visitor.index()
      } catch (error) {
        console.error(
          `unexpected error indexing project root '${this.options.cwd}'`,
          error
        )
      }
      if (visitor.document.occurrences.length > 0) {
        this.options.writeIndex(
          new scip.scip.Index({
            documents: [visitor.document],
          })
        )
      }
    }
    jobs?.terminate()
    const elapsed = Date.now() - startTimestamp
    if (!this.options.progressBar && lastWrite > startTimestamp) {
      process.stdout.write('\n')
    }
    console.log(
      `+ ${this.options.projectDisplayName} (${prettyMilliseconds(elapsed)})`
    )
  }
}

function isSameLanguageVersion(
  a: ts.ScriptTarget | ts.CreateSourceFileOptions,
  b: ts.ScriptTarget | ts.CreateSourceFileOptions
): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b
  }
  if (typeof a === 'number' || typeof b === 'number') {
    // Different shape: one is ts.ScriptTarget, the other is
    // ts.CreateSourceFileOptions
    return false
  }
  return (
    a.languageVersion === b.languageVersion &&
    a.impliedNodeFormat === b.impliedNodeFormat
    // Ignore setExternalModuleIndicator even if that increases the risk of a
    // false positive. A local experiment revealed that we never get a cache hit
    // if we compare setExternalModuleIndicator since it's function with a
    // unique reference on every `CompilerHost.getSourceFile` callback.
  )
}
