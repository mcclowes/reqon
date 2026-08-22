/**
 * Pipeline parsing
 * Handles parsing of pipeline definitions and stages.
 */
import { TokenType, type Expression } from 'vague-lang';
import { ReqonTokenType } from '../lexer/tokens.js';
import type { PipelineDefinition, PipelineStage } from '../ast/nodes.js';
import { ActionParser } from './action-parser.js';

export class PipelineParser extends ActionParser {
  /**
   * Parse a pipeline definition: run ActionA then ActionB then [ActionC, ActionD]
   */
  parsePipeline(): PipelineDefinition {
    this.consume(ReqonTokenType.RUN, "Expected 'run'");

    const stages: PipelineStage[] = [];

    // First stage
    stages.push(this.parsePipelineStage());

    // Subsequent stages with 'then'
    while (this.match(TokenType.THEN)) {
      stages.push(this.parsePipelineStage());
    }

    return { type: 'PipelineDefinition', stages };
  }

  /**
   * Parse a single pipeline stage (can be single action or parallel actions)
   */
  protected parsePipelineStage(): PipelineStage {
    let condition: Expression | undefined;

    // Check for parallel stage: [Action1, Action2, ...]
    if (this.match(TokenType.LBRACKET)) {
      const actions: string[] = [];

      // First action
      actions.push(this.consume(TokenType.IDENTIFIER, 'Expected action name').value);

      // Additional actions separated by commas
      while (this.match(TokenType.COMMA)) {
        actions.push(this.consume(TokenType.IDENTIFIER, 'Expected action name').value);
      }

      this.consume(TokenType.RBRACKET, "Expected ']'");

      // Optional 'if' condition
      if (this.match(TokenType.IF)) {
        condition = this.parseExpression();
      }

      return { actions, condition };
    }

    // Single action (sequential)
    const action = this.consume(TokenType.IDENTIFIER, 'Expected action name').value;

    // Optional 'if' condition
    if (this.match(TokenType.IF)) {
      condition = this.parseExpression();
    }

    return { action, condition };
  }
}
