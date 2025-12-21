/**
 * Main Reqon Parser
 *
 * This is the top-level parser that combines all domain-specific parser modules.
 * The parser is organized as an inheritance chain:
 *
 * ReqonParserBase (token manipulation)
 *   └─ ReqonExpressionParser (expression parsing)
 *       └─ SourceParser (source definitions, auth config)
 *           └─ ScheduleParser (schedule definitions)
 *               └─ FetchParser (fetch steps, pagination, retry)
 *                   └─ ActionParser (actions, steps, transforms)
 *                       └─ PipelineParser (pipeline stages)
 *                           └─ ReqonParser (mission parsing, validation)
 */
import { TokenType, type SchemaDefinition, type Token } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type {
  ReqonProgram,
  Statement,
  MissionDefinition,
  SourceDefinition,
  StoreDefinition,
  ActionDefinition,
  ActionStep,
  TransformDefinition,
  PipelineDefinition,
  ScheduleDefinition,
} from '../ast/nodes.js';
import { PipelineParser } from './pipeline-parser.js';

export class ReqonParser extends PipelineParser {
  constructor(tokens: Token[], source?: string, filePath?: string) {
    super(tokens, source, filePath);
  }

  /**
   * Parse a complete Reqon program
   */
  parse(): ReqonProgram {
    const statements: Statement[] = [];

    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }

    return { type: 'ReqonProgram', statements };
  }

  /**
   * Parse a top-level statement
   */
  private parseStatement(): Statement | null {
    // Reqon-specific statements
    if (this.check(ReqonTokenType.MISSION)) return this.parseMission();
    if (this.check(ReqonTokenType.SOURCE)) return this.parseSource();
    if (this.check(ReqonTokenType.STORE)) return this.parseStoreDefinition();
    if (this.check(ReqonTokenType.ACTION)) return this.parseAction();
    if (this.check(ReqonTokenType.TRANSFORM)) return this.parseTransform();

    // Vague statements (schema, import, let, etc.)
    if (this.check(TokenType.SCHEMA)) return this.parseSchema();
    if (this.check(TokenType.IMPORT)) return this.parseImport();
    if (this.check(TokenType.LET)) return this.parseLet();

    throw this.error(`Unexpected token: ${this.peek().value}`);
  }

  /**
   * Parse a mission definition
   */
  private parseMission(): MissionDefinition {
    this.consume(ReqonTokenType.MISSION, "Expected 'mission'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected mission name').value;

    this.consume(TokenType.LBRACE, "Expected '{'");

    const sources: SourceDefinition[] = [];
    const stores: StoreDefinition[] = [];
    const schemas: SchemaDefinition[] = [];
    const transforms: TransformDefinition[] = [];
    const actions: ActionDefinition[] = [];
    let pipeline: PipelineDefinition | undefined;
    let schedule: ScheduleDefinition | undefined;

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      if (this.check(ReqonTokenType.SOURCE)) {
        sources.push(this.parseSource());
      } else if (this.check(ReqonTokenType.STORE)) {
        stores.push(this.parseStoreDefinition());
      } else if (this.check(TokenType.SCHEMA)) {
        schemas.push(this.parseSchema());
      } else if (this.check(ReqonTokenType.TRANSFORM)) {
        transforms.push(this.parseTransform());
      } else if (this.check(ReqonTokenType.ACTION)) {
        actions.push(this.parseAction());
      } else if (this.check(ReqonTokenType.RUN)) {
        pipeline = this.parsePipeline();
      } else if (this.check(ReqonTokenType.SCHEDULE)) {
        schedule = this.parseSchedule();
      } else {
        throw this.error(`Unexpected token in mission: ${this.peek().value}`);
      }
      this.match(TokenType.COMMA);
    }

    this.consume(TokenType.RBRACE, "Expected '}'");

    if (!pipeline) {
      throw this.error('Mission must have a run pipeline');
    }

    // Build sets of defined names for validation
    const definedStores = new Set(stores.map((s) => s.name));
    const definedActions = new Set(actions.map((a) => a.name));
    const definedSources = new Set(sources.map((s) => s.name));
    const definedTransforms = new Set(transforms.map((t) => t.name));

    // Validate all references within actions (stores, sources)
    this.validateActionReferences(actions, definedStores, definedSources, definedActions, definedTransforms);

    return {
      type: 'MissionDefinition',
      name,
      schedule,
      sources,
      stores,
      schemas,
      transforms,
      actions,
      pipeline,
    };
  }

  /**
   * Validate that all store, source, action, and transform references in actions exist
   */
  private validateActionReferences(
    actions: ActionDefinition[],
    definedStores: Set<string>,
    definedSources: Set<string>,
    definedActions: Set<string>,
    definedTransforms: Set<string>
  ): void {
    for (const action of actions) {
      this.validateStepsReferences(
        action.steps,
        definedStores,
        definedSources,
        definedActions,
        definedTransforms,
        action.name
      );
    }
  }

  /**
   * Recursively validate store, source, action, and transform references in action steps
   */
  private validateStepsReferences(
    steps: ActionStep[],
    definedStores: Set<string>,
    definedSources: Set<string>,
    definedActions: Set<string>,
    definedTransforms: Set<string>,
    actionName: string
  ): void {
    for (const step of steps) {
      this.validateStepReferences(step, definedStores, definedSources, definedActions, definedTransforms, actionName);
    }
  }

  /**
   * Validate references in a single step
   */
  private validateStepReferences(
    step: ActionStep,
    definedStores: Set<string>,
    definedSources: Set<string>,
    definedActions: Set<string>,
    definedTransforms: Set<string>,
    actionName: string
  ): void {
    switch (step.type) {
      case 'StoreStep':
        if (!definedStores.has(step.target)) {
          throw this.error(
            `Store '${step.target}' is not defined. ` +
              `Available stores: ${[...definedStores].join(', ') || 'none'}`
          );
        }
        break;

      case 'FetchStep':
        // Validate source reference if specified
        if (step.source && !definedSources.has(step.source)) {
          throw this.error(
            `Source '${step.source}' is not defined. ` +
              `Available sources: ${[...definedSources].join(', ') || 'none'}`
          );
        }
        // Validate operationRef source if present
        if (step.operationRef && !definedSources.has(step.operationRef.source)) {
          throw this.error(
            `Source '${step.operationRef.source}' is not defined. ` +
              `Available sources: ${[...definedSources].join(', ') || 'none'}`
          );
        }
        break;

      case 'ApplyStep':
        // Validate transform reference
        if (!definedTransforms.has(step.transform)) {
          throw this.error(
            `Transform '${step.transform}' is not defined. ` +
              `Available transforms: ${[...definedTransforms].join(', ') || 'none'}`
          );
        }
        break;

      case 'ForStep':
        // Recursively validate nested steps
        this.validateStepsReferences(
          step.steps,
          definedStores,
          definedSources,
          definedActions,
          definedTransforms,
          actionName
        );
        break;

      case 'MatchStep':
        // Validate steps in match arms
        for (const arm of step.arms) {
          if (arm.steps) {
            this.validateStepsReferences(
              arm.steps,
              definedStores,
              definedSources,
              definedActions,
              definedTransforms,
              actionName
            );
          }
          // Validate jump target in flow directive
          if (arm.flow?.type === 'jump' && !definedActions.has(arm.flow.action)) {
            throw this.error(
              `Action '${arm.flow.action}' referenced in jump is not defined. ` +
                `Available actions: ${[...definedActions].join(', ') || 'none'}`
            );
          }
        }
        break;
    }
  }

  /**
   * Validate that all action references in the pipeline exist
   * Note: This is called by the loader after action merging
   */
  validatePipelineReferences(
    pipeline: PipelineDefinition,
    definedActions: Set<string>
  ): void {
    for (const stage of pipeline.stages) {
      if (stage.action) {
        if (!definedActions.has(stage.action)) {
          throw this.error(
            `Action '${stage.action}' is not defined. ` +
              `Available actions: ${[...definedActions].join(', ') || 'none'}`
          );
        }
      }
      if (stage.actions) {
        for (const actionName of stage.actions) {
          if (!definedActions.has(actionName)) {
            throw this.error(
              `Action '${actionName}' is not defined. ` +
                `Available actions: ${[...definedActions].join(', ') || 'none'}`
            );
          }
        }
      }
    }
  }

  /**
   * Parse an import statement
   */
  private parseImport(): Statement {
    this.consume(TokenType.IMPORT, "Expected 'import'");
    const name = this.consume(TokenType.IDENTIFIER, 'Expected import name').value;
    this.consume(TokenType.FROM, "Expected 'from'");
    const path = this.consume(TokenType.STRING, 'Expected import path').value;

    return { type: 'ImportStatement', name, path };
  }

  /**
   * Parse a let statement
   */
  private parseLet(): Statement {
    this.consume(TokenType.LET, "Expected 'let'");
    const name = this.consumeIdentifier('Expected variable name').value;
    this.consume(TokenType.EQUALS, "Expected '='");
    const value = this.parseExpression();

    return { type: 'LetStatement', name, value };
  }
}
