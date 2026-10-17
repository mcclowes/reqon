import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

interface ScriptPackage {
  scripts: Record<string, string>;
}

const rootPackage = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
) as ScriptPackage;
const workspacePackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as ScriptPackage;
const tasks = Object.keys(rootPackage.scripts).filter((name) => name in workspacePackage.scripts);

interface CommandFixture {
  directory: string;
  record: string;
  run: (task: string, args: string[], exitCode?: number) => SpawnSyncReturns<string>;
}

function createFixture(): CommandFixture {
  const npmExecutable = process.env.npm_execpath;
  if (!npmExecutable) throw new Error('Run root command tests through npm.');
  const npm = join(dirname(npmExecutable), 'npm-cli.js');
  if (!existsSync(npm)) throw new Error('The npm CLI is required for root command tests.');
  const directory = mkdtempSync(join(tmpdir(), 'reqon root arguments '));
  const workspace = join(directory, 'packages', 'reqon-dsl');
  mkdirSync(workspace, { recursive: true });
  const record = join(directory, 'arguments.json');

  // Exercise the real root delegates with harmless workspace tools.
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'reqon-root-fixture',
      private: true,
      workspaces: ['packages/reqon-dsl'],
      scripts: rootPackage.scripts,
    })
  );
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({
      name: 'reqon-dsl',
      version: '0.0.0',
      private: true,
      scripts: Object.fromEntries(tasks.map((task) => [task, 'node record.mjs'])),
    })
  );
  writeFileSync(
    join(workspace, 'record.mjs'),
    `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.REQON_ROOT_ARGUMENTS_FILE, JSON.stringify({
  task: process.env.npm_lifecycle_event, arguments: process.argv.slice(2)
}));
process.exit(Number(process.env.REQON_ROOT_EXIT_CODE || 0));
`
  );
  for (const name of ['user.npmrc', 'global.npmrc']) writeFileSync(join(directory, name), '');
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.toLowerCase().startsWith('npm_') &&
        !['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'RUN_NETWORK_TESTS', 'DATABASE_URL'].includes(name)
    )
  );

  return {
    directory,
    record,
    run: (task, args, exitCode = 0) =>
      spawnSync(process.execPath, [npm, 'run', task, '--', ...args], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...environment,
          PATH: `${dirname(process.execPath)}${delimiter}${environment.PATH ?? ''}`,
          npm_config_cache: join(directory, 'cache'),
          npm_config_userconfig: join(directory, 'user.npmrc'),
          npm_config_globalconfig: join(directory, 'global.npmrc'),
          npm_config_offline: 'true',
          npm_config_loglevel: 'error',
          REQON_ROOT_ARGUMENTS_FILE: record,
          REQON_ROOT_EXIT_CODE: String(exitCode),
        },
      }),
  };
}

describe('root workspace commands', () => {
  it.each(tasks)('forwards %s flags to the workspace tool', (task) => {
    const fixture = createFixture();
    try {
      const args = ['--help', 'path with spaces', '--literal=value'];
      const result = fixture.run(task, args);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(fixture.record), result.stdout).toBe(true);
      expect(JSON.parse(readFileSync(fixture.record, 'utf8'))).toEqual({ task, arguments: args });
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it('keeps no-argument runs unchanged', () => {
    const fixture = createFixture();
    try {
      const result = fixture.run('build', []);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(fixture.record, 'utf8'))).toEqual({
        task: 'build',
        arguments: [],
      });
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it('preserves workspace tool failures', () => {
    const fixture = createFixture();
    try {
      const args = ['--help'];
      const result = fixture.run('build', args, 7);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(7);
      expect(JSON.parse(readFileSync(fixture.record, 'utf8'))).toEqual({
        task: 'build',
        arguments: args,
      });
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
