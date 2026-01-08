import { describe, it, expect } from 'vitest';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from './parser.js';
import type { MissionDefinition, ActionDefinition, PauseStep } from '../ast/nodes.js';

function parse(source: string) {
  const lexer = new ReqonLexer(source);
  const tokens = lexer.tokenize();
  const parser = new ReqonParser(tokens, source);
  return parser.parse();
}

describe('Checkpoint Parsing', () => {
  it('parses checkpoint: afterStep', () => {
    const source = `
      mission TestMission {
        checkpoint: afterStep
        action Test {
          get "/test"
        }
        run Test
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;

    expect(mission.checkpoint).toBeDefined();
    expect(mission.checkpoint!.mode).toBe('after-step');
  });

  it('parses checkpoint: onFailure', () => {
    const source = `
      mission TestMission {
        checkpoint: onFailure
        action Test {
          get "/test"
        }
        run Test
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;

    expect(mission.checkpoint).toBeDefined();
    expect(mission.checkpoint!.mode).toBe('on-failure');
  });
});

describe('Trace Parsing', () => {
  it('parses trace: full', () => {
    const source = `
      mission TestMission {
        trace: full
        action Test {
          get "/test"
        }
        run Test
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;

    expect(mission.trace).toBeDefined();
    expect(mission.trace!.mode).toBe('full');
  });

  it('parses trace: minimal', () => {
    const source = `
      mission TestMission {
        trace: minimal
        action Test {
          get "/test"
        }
        run Test
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;

    expect(mission.trace).toBeDefined();
    expect(mission.trace!.mode).toBe('minimal');
  });
});

describe('Pause Step Parsing', () => {
  it('parses pause with duration string', () => {
    const source = `
      mission TestMission {
        action WaitForApproval {
          pause {
            duration: "7d"
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.type).toBe('PauseStep');
    expect(pauseStep.duration).toBe('7d');
  });

  it('parses pause with duration number', () => {
    const source = `
      mission TestMission {
        action WaitForApproval {
          pause {
            duration: 86400000
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.type).toBe('PauseStep');
    expect(pauseStep.duration).toBe(86400000);
  });

  it('parses pause with persist option', () => {
    const source = `
      mission TestMission {
        store PauseStore: file("pauses")
        action WaitForApproval {
          pause {
            duration: "1d",
            persist: PauseStore
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.persist).toBe('PauseStore');
  });

  it('parses pause with timeout resume trigger', () => {
    const source = `
      mission TestMission {
        action WaitForApproval {
          pause {
            duration: "7d",
            resumeOn: timeout
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.resumeOn).toBeDefined();
    expect(pauseStep.resumeOn).toHaveLength(1);
    expect(pauseStep.resumeOn![0].type).toBe('timeout');
  });

  it('parses pause with webhook resume trigger', () => {
    const source = `
      mission TestMission {
        action WaitForApproval {
          pause {
            duration: "7d",
            resumeOn: webhook "/approved"
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.resumeOn).toBeDefined();
    expect(pauseStep.resumeOn).toHaveLength(1);
    expect(pauseStep.resumeOn![0].type).toBe('webhook');
    if (pauseStep.resumeOn![0].type === 'webhook') {
      expect(pauseStep.resumeOn![0].path).toBe('/approved');
    }
  });

  it('parses pause with multiple resume triggers', () => {
    const source = `
      mission TestMission {
        action WaitForApproval {
          pause {
            duration: "7d",
            resumeOn: timeout | webhook "/approved"
          }
        }
        run WaitForApproval
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;
    const action = mission.actions[0] as ActionDefinition;
    const pauseStep = action.steps[0] as PauseStep;

    expect(pauseStep.resumeOn).toBeDefined();
    expect(pauseStep.resumeOn).toHaveLength(2);
    expect(pauseStep.resumeOn![0].type).toBe('timeout');
    expect(pauseStep.resumeOn![1].type).toBe('webhook');
  });
});

describe('Combined Durability Features', () => {
  it('parses mission with checkpoint, trace, and pause', () => {
    const source = `
      mission SyncWithApproval {
        checkpoint: afterStep
        trace: full

        source API { auth: none, base: "https://api.example.com" }
        store DataStore: memory("data")

        action FetchData {
          get "/data"
          store response -> DataStore { key: .id }
        }

        action WaitForApproval {
          pause {
            duration: "7d",
            resumeOn: timeout | webhook "/approved"
          }
        }

        action ProcessData {
          for item in DataStore {
            get "/process/{item.id}"
          }
        }

        run FetchData then WaitForApproval then ProcessData
      }
    `;
    const program = parse(source);
    const mission = program.statements[0] as MissionDefinition;

    expect(mission.name).toBe('SyncWithApproval');
    expect(mission.checkpoint).toBeDefined();
    expect(mission.checkpoint!.mode).toBe('after-step');
    expect(mission.trace).toBeDefined();
    expect(mission.trace!.mode).toBe('full');
    expect(mission.actions).toHaveLength(3);

    const waitAction = mission.actions.find((a) => a.name === 'WaitForApproval');
    expect(waitAction).toBeDefined();
    expect(waitAction!.steps[0].type).toBe('PauseStep');
  });
});
