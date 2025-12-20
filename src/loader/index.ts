import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/index.js';
import type { ReqonProgram, MissionDefinition, ActionDefinition, Statement } from '../ast/nodes.js';

export interface LoadResult {
  program: ReqonProgram;
  /** Base directory for the mission (folder path or file's parent) */
  baseDir: string;
  /** All source files that were loaded */
  sourceFiles: string[];
}

export interface LoadOptions {
  /** File extension to look for (default: '.reqon') */
  extension?: string;
}

/**
 * Load a mission from a file or folder.
 *
 * Single file mode:
 *   loadMission('./sync-invoices.reqon')
 *   Returns the parsed program from that file.
 *
 * Folder mode:
 *   loadMission('./sync-invoices/')
 *   Looks for mission.reqon (root) and merges all *.reqon action files.
 *   Actions are resolved by name from the `run` pipeline.
 */
export async function loadMission(
  path: string,
  options: LoadOptions = {}
): Promise<LoadResult> {
  const absolutePath = resolve(path);
  const stats = await stat(absolutePath);

  if (stats.isDirectory()) {
    return loadMissionFolder(absolutePath, options);
  } else {
    return loadMissionFile(absolutePath);
  }
}

/**
 * Load a single .reqon file
 */
async function loadMissionFile(filePath: string): Promise<LoadResult> {
  const source = await readFile(filePath, 'utf-8');
  const program = parseSource(source, filePath);

  return {
    program,
    baseDir: dirname(filePath),
    sourceFiles: [filePath],
  };
}

/**
 * Load a mission from a folder.
 *
 * Expected structure:
 *   mission-name/
 *   ├── mission.reqon      # Root file with mission definition (sources, stores, pipeline)
 *   ├── fetch-list.reqon   # Action file
 *   ├── hydrate.reqon      # Action file
 *   └── normalize.reqon    # Action file
 *
 * The root file (mission.reqon) contains:
 * - source definitions
 * - store definitions
 * - schema definitions
 * - the pipeline (run X then Y then Z)
 * - optionally inline actions
 *
 * Action files contain standalone action definitions that get merged in.
 */
async function loadMissionFolder(
  folderPath: string,
  options: LoadOptions
): Promise<LoadResult> {
  const ext = options.extension ?? '.reqon';
  const rootFileName = `mission${ext}`;
  const rootFilePath = join(folderPath, rootFileName);

  // Check root file exists
  try {
    await stat(rootFilePath);
  } catch {
    throw new Error(
      `Mission folder must contain a '${rootFileName}' file. ` +
      `Not found: ${rootFilePath}`
    );
  }

  // Load root file
  const rootSource = await readFile(rootFilePath, 'utf-8');
  const rootProgram = parseSource(rootSource, rootFilePath);

  // Find all other .reqon files in the folder
  const files = await readdir(folderPath);
  const actionFiles = files.filter(
    f => f.endsWith(ext) && f !== rootFileName
  );

  const sourceFiles = [rootFilePath];
  const externalActions: ActionDefinition[] = [];

  // Parse each action file
  for (const file of actionFiles) {
    const filePath = join(folderPath, file);
    sourceFiles.push(filePath);

    const source = await readFile(filePath, 'utf-8');
    const actionProgram = parseSource(source, filePath);

    // Extract action definitions from the file
    for (const stmt of actionProgram.statements) {
      if (stmt.type === 'ActionDefinition') {
        externalActions.push(stmt);
      } else if (stmt.type === 'MissionDefinition') {
        throw new Error(
          `Action file '${file}' should not contain a mission definition. ` +
          `Only '${rootFileName}' should define the mission.`
        );
      }
    }
  }

  // Merge external actions into the mission
  const mergedProgram = mergeActions(rootProgram, externalActions);

  // Validate that all actions referenced in the pipeline exist
  validatePipelineActions(mergedProgram);

  return {
    program: mergedProgram,
    baseDir: folderPath,
    sourceFiles,
  };
}

/**
 * Parse source code into a program
 */
function parseSource(source: string, filePath: string): ReqonProgram {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source, filePath);
  return parser.parse();
}

/**
 * Merge external actions into the mission definition
 */
function mergeActions(
  program: ReqonProgram,
  externalActions: ActionDefinition[]
): ReqonProgram {
  // Find the mission in the program
  const missionIndex = program.statements.findIndex(
    (s): s is MissionDefinition => s.type === 'MissionDefinition'
  );

  if (missionIndex === -1) {
    throw new Error('Root file must contain a mission definition');
  }

  const mission = program.statements[missionIndex] as MissionDefinition;

  // Build a map of existing actions
  const actionMap = new Map<string, ActionDefinition>();
  for (const action of mission.actions) {
    actionMap.set(action.name, action);
  }

  // Add external actions (error if duplicate)
  for (const action of externalActions) {
    if (actionMap.has(action.name)) {
      throw new Error(
        `Duplicate action definition: '${action.name}'. ` +
        `Action names must be unique across all files.`
      );
    }
    actionMap.set(action.name, action);
  }

  // Create updated mission with all actions
  const updatedMission: MissionDefinition = {
    ...mission,
    actions: Array.from(actionMap.values()),
  };

  // Return updated program
  const updatedStatements = [...program.statements];
  updatedStatements[missionIndex] = updatedMission;

  return {
    type: 'ReqonProgram',
    statements: updatedStatements,
  };
}

/**
 * Validate that all actions referenced in the pipeline exist
 */
function validatePipelineActions(program: ReqonProgram): void {
  const mission = program.statements.find(
    (s): s is MissionDefinition => s.type === 'MissionDefinition'
  );

  if (!mission) return;

  const actionNames = new Set(mission.actions.map(a => a.name));

  for (const stage of mission.pipeline.stages) {
    const stageActions = stage.actions ?? (stage.action ? [stage.action] : []);

    for (const actionName of stageActions) {
      if (!actionNames.has(actionName)) {
        throw new Error(
          `Pipeline references unknown action: '${actionName}'. ` +
          `Available actions: ${Array.from(actionNames).join(', ')}`
        );
      }
    }
  }
}

/**
 * Check if a path is a mission folder (contains mission.reqon)
 */
export async function isMissionFolder(path: string): Promise<boolean> {
  try {
    const absolutePath = resolve(path);
    const stats = await stat(absolutePath);

    if (!stats.isDirectory()) return false;

    const rootFile = join(absolutePath, 'mission.reqon');
    await stat(rootFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the mission name from a path (folder name or file name without extension)
 */
export function getMissionName(path: string): string {
  const absolutePath = resolve(path);
  const name = basename(absolutePath);

  if (name.endsWith('.reqon')) {
    return name.slice(0, -6);
  }
  return name;
}
