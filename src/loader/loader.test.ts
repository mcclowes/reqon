import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMission, isMissionFolder, getMissionName } from './index.js';

const TEST_DIR = '.test-missions';

describe('Mission Loader', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('single file loading', () => {
    it('loads a single .reqon file', async () => {
      const filePath = join(TEST_DIR, 'simple.reqon');
      await writeFile(filePath, `
        mission Simple {
          source Api {
            auth: none,
            base: "https://api.example.com"
          }

          store data: memory("items")

          action Fetch {
            get "/items" { source: Api }
            store response -> data
          }

          run Fetch
        }
      `);

      const result = await loadMission(filePath);

      expect(result.sourceFiles).toHaveLength(1);
      expect(result.sourceFiles[0]).toContain('simple.reqon');

      const mission = result.program.statements.find(
        s => s.type === 'MissionDefinition'
      );
      expect(mission).toBeDefined();
      expect((mission as any).name).toBe('Simple');
      expect((mission as any).actions).toHaveLength(1);
    });

    it('loads a single .vague file', async () => {
      const filePath = join(TEST_DIR, 'simple.vague');
      await writeFile(filePath, `
        mission Simple {
          source Api {
            auth: none,
            base: "https://api.example.com"
          }

          store data: memory("items")

          action Fetch {
            get "/items" { source: Api }
            store response -> data
          }

          run Fetch
        }
      `);

      const result = await loadMission(filePath);

      expect(result.sourceFiles).toHaveLength(1);
      expect(result.sourceFiles[0]).toContain('simple.vague');

      const mission = result.program.statements.find(
        s => s.type === 'MissionDefinition'
      );
      expect(mission).toBeDefined();
      expect((mission as any).name).toBe('Simple');
    });
  });

  describe('folder loading', () => {
    it('loads mission from folder with separate action files', async () => {
      const missionDir = join(TEST_DIR, 'sync-invoices');
      await mkdir(missionDir, { recursive: true });

      // Root mission file
      await writeFile(join(missionDir, 'mission.reqon'), `
        mission SyncInvoices {
          source Xero {
            auth: oauth2,
            base: "https://api.xero.com"
          }

          store invoices: memory("invoices")
          store details: memory("invoice_details")

          run FetchList then Hydrate
        }
      `);

      // Action files
      await writeFile(join(missionDir, 'fetch-list.reqon'), `
        action FetchList {
          get "/invoices" { source: Xero }
          store response -> invoices
        }
      `);

      await writeFile(join(missionDir, 'hydrate.reqon'), `
        action Hydrate {
          for invoice in invoices {
            get "/invoices/{invoice.id}" { source: Xero }
            store response -> details
          }
        }
      `);

      const result = await loadMission(missionDir);

      expect(result.sourceFiles).toHaveLength(3);
      expect(result.baseDir).toContain('sync-invoices');

      const mission = result.program.statements.find(
        s => s.type === 'MissionDefinition'
      );
      expect(mission).toBeDefined();
      expect((mission as any).name).toBe('SyncInvoices');
      expect((mission as any).actions).toHaveLength(2);

      const actionNames = (mission as any).actions.map((a: any) => a.name);
      expect(actionNames).toContain('FetchList');
      expect(actionNames).toContain('Hydrate');
    });

    it('errors if mission.reqon is missing from folder', async () => {
      const missionDir = join(TEST_DIR, 'no-root');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'action.reqon'), `
        action SomeAction {
          get "/test" { source: Api }
        }
      `);

      await expect(loadMission(missionDir)).rejects.toThrow(
        /must contain a root file/
      );
    });

    it('errors if action file contains a mission definition', async () => {
      const missionDir = join(TEST_DIR, 'bad-action');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'mission.reqon'), `
        mission Main {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")
          run Fetch
        }
      `);

      await writeFile(join(missionDir, 'nested.reqon'), `
        mission NestedMission {
          source Api { auth: none, base: "https://other.com" }
          store data: memory("data")
          run Something
        }
      `);

      await expect(loadMission(missionDir)).rejects.toThrow(
        /should not contain a mission definition/
      );
    });

    it('errors on duplicate action names', async () => {
      const missionDir = join(TEST_DIR, 'duplicate');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'mission.reqon'), `
        mission Main {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")

          action Fetch {
            get "/a" { source: Api }
          }

          run Fetch
        }
      `);

      await writeFile(join(missionDir, 'fetch.reqon'), `
        action Fetch {
          get "/b" { source: Api }
        }
      `);

      await expect(loadMission(missionDir)).rejects.toThrow(
        /Duplicate action definition: 'Fetch'/
      );
    });

    it('errors if pipeline references unknown action', async () => {
      const missionDir = join(TEST_DIR, 'unknown-action');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'mission.reqon'), `
        mission Main {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")

          action Fetch {
            get "/items" { source: Api }
          }

          run Fetch then NonExistent
        }
      `);

      await expect(loadMission(missionDir)).rejects.toThrow(
        /Pipeline references unknown action: 'NonExistent'/
      );
    });

    it('supports inline actions alongside external files', async () => {
      const missionDir = join(TEST_DIR, 'mixed');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'mission.reqon'), `
        mission Mixed {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")

          action InlineAction {
            get "/inline" { source: Api }
          }

          run InlineAction then ExternalAction
        }
      `);

      await writeFile(join(missionDir, 'external.reqon'), `
        action ExternalAction {
          get "/external" { source: Api }
          store response -> data
        }
      `);

      const result = await loadMission(missionDir);

      const mission = result.program.statements.find(
        s => s.type === 'MissionDefinition'
      );
      expect((mission as any).actions).toHaveLength(2);
    });
  });

  describe('isMissionFolder', () => {
    it('returns true for folder with mission.reqon', async () => {
      const missionDir = join(TEST_DIR, 'valid-folder');
      await mkdir(missionDir, { recursive: true });
      await writeFile(join(missionDir, 'mission.reqon'), 'mission X { run A }');

      expect(await isMissionFolder(missionDir)).toBe(true);
    });

    it('returns true for folder with mission.vague', async () => {
      const missionDir = join(TEST_DIR, 'vague-folder');
      await mkdir(missionDir, { recursive: true });
      await writeFile(join(missionDir, 'mission.vague'), 'mission X { run A }');

      expect(await isMissionFolder(missionDir)).toBe(true);
    });

    it('returns false for folder without mission.reqon', async () => {
      const missionDir = join(TEST_DIR, 'invalid-folder');
      await mkdir(missionDir, { recursive: true });

      expect(await isMissionFolder(missionDir)).toBe(false);
    });

    it('returns false for a file', async () => {
      const filePath = join(TEST_DIR, 'file.reqon');
      await writeFile(filePath, 'mission X { run A }');

      expect(await isMissionFolder(filePath)).toBe(false);
    });
  });

  describe('getMissionName', () => {
    it('extracts name from folder path', () => {
      expect(getMissionName('/path/to/sync-invoices')).toBe('sync-invoices');
    });

    it('extracts name from .reqon file path', () => {
      expect(getMissionName('/path/to/sync-invoices.reqon')).toBe('sync-invoices');
    });

    it('extracts name from .vague file path', () => {
      expect(getMissionName('/path/to/sync-invoices.vague')).toBe('sync-invoices');
    });
  });

  describe('.vague file priority', () => {
    it('prefers .vague over .reqon in folder mode', async () => {
      const missionDir = join(TEST_DIR, 'both-extensions');
      await mkdir(missionDir, { recursive: true });

      // Create both files - .vague should be preferred
      await writeFile(join(missionDir, 'mission.vague'), `
        mission FromVague {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")
          action Fetch { get "/vague" { source: Api } }
          run Fetch
        }
      `);
      await writeFile(join(missionDir, 'mission.reqon'), `
        mission FromReqon {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")
          action Fetch { get "/reqon" { source: Api } }
          run Fetch
        }
      `);

      const result = await loadMission(missionDir);
      const mission = result.program.statements.find(
        s => s.type === 'MissionDefinition'
      );
      expect((mission as any).name).toBe('FromVague');
    });

    it('loads folder with mission.vague and .vague action files', async () => {
      const missionDir = join(TEST_DIR, 'vague-folder-mode');
      await mkdir(missionDir, { recursive: true });

      await writeFile(join(missionDir, 'mission.vague'), `
        mission VagueMode {
          source Api { auth: none, base: "https://api.example.com" }
          store data: memory("data")
          run Fetch
        }
      `);
      await writeFile(join(missionDir, 'fetch.vague'), `
        action Fetch {
          get "/items" { source: Api }
        }
      `);

      const result = await loadMission(missionDir);
      expect(result.sourceFiles).toHaveLength(2);
      expect(result.sourceFiles[0]).toContain('mission.vague');
      expect(result.sourceFiles[1]).toContain('fetch.vague');
    });
  });
});
