import { describe, it, expect } from 'vitest';
import {
  ReqonError,
  ParseError,
  LexerError,
  RuntimeError,
  ValidationError,
  formatErrors,
  getSourceLine,
  getSourceContext,
} from './index.js';
import { ReqonLexer } from '../lexer/index.js';
import { ReqonParser } from '../parser/index.js';

describe('Error classes', () => {
  describe('ReqonError', () => {
    it('should format error with location', () => {
      const error = new ReqonError('Something went wrong', { line: 5, column: 10 });
      const formatted = error.format();

      expect(formatted).toContain('ReqonError: Something went wrong');
      expect(formatted).toContain('5:10');
    });

    it('should format error with source context', () => {
      const source = `mission Test {
  source API {
    auth: bearer,
    base: "https://api.example.com"
  }
}`;
      const error = new ReqonError('Unexpected token', { line: 3, column: 5 }, { source });
      const formatted = error.format();

      expect(formatted).toContain('auth: bearer,');
      expect(formatted).toContain('3 |');
      expect(formatted).toContain('^');
    });

    it('should include file path when provided', () => {
      const error = new ReqonError(
        'Test error',
        { line: 1, column: 1 },
        { source: 'test', filePath: '/path/to/file.reqon' }
      );
      const formatted = error.format();

      expect(formatted).toContain('/path/to/file.reqon:');
    });
  });

  describe('ParseError', () => {
    it('should include token value in format', () => {
      const error = new ParseError(
        "Expected '{'",
        { line: 2, column: 15 },
        undefined,
        'identifier'
      );
      const formatted = error.format();

      expect(formatted).toContain("found: 'identifier'");
    });

    it('should format with source context and pointer', () => {
      const source = `mission Test {
  source API auth: bearer
}`;
      const error = new ParseError(
        "Expected '{'",
        { line: 2, column: 14 },
        { source },
        'auth'
      );
      const formatted = error.format();

      expect(formatted).toContain('ParseError');
      expect(formatted).toContain('2:14');
      expect(formatted).toContain('source API auth: bearer');
      expect(formatted).toContain('^');
    });
  });

  describe('LexerError', () => {
    it('should format with source context', () => {
      const source = 'mission Test { @ }';
      const error = new LexerError(
        "Unexpected character '@'",
        { line: 1, column: 16 },
        { source }
      );
      const formatted = error.format();

      expect(formatted).toContain('LexerError');
      expect(formatted).toContain("Unexpected character '@'");
    });
  });

  describe('RuntimeError', () => {
    it('should include action and step info', () => {
      const error = new RuntimeError(
        'Request failed with status 404',
        { line: 5, column: 3 },
        undefined,
        { action: 'FetchData', stepType: 'fetch' }
      );
      const formatted = error.format();

      expect(formatted).toContain('in action: FetchData');
      expect(formatted).toContain('at step: fetch');
    });
  });

  describe('ValidationError', () => {
    it('should include severity', () => {
      const error = new ValidationError(
        'Value must be positive',
        { line: 10, column: 5 },
        undefined,
        { severity: 'warning' }
      );

      expect(error.severity).toBe('warning');
    });
  });
});

describe('formatErrors', () => {
  it('should format multiple errors', () => {
    const errors = [
      new ParseError('Error 1', { line: 1, column: 1 }),
      new ParseError('Error 2', { line: 5, column: 10 }),
    ];

    const formatted = formatErrors(errors);

    expect(formatted).toContain('Error 1');
    expect(formatted).toContain('Error 2');
    expect(formatted).toContain('1:1');
    expect(formatted).toContain('5:10');
  });
});

describe('getSourceLine', () => {
  it('should return the correct line', () => {
    const source = 'line1\nline2\nline3';

    expect(getSourceLine(source, 1)).toBe('line1');
    expect(getSourceLine(source, 2)).toBe('line2');
    expect(getSourceLine(source, 3)).toBe('line3');
  });

  it('should return undefined for out of range', () => {
    const source = 'line1\nline2';

    expect(getSourceLine(source, 5)).toBeUndefined();
  });
});

describe('getSourceContext', () => {
  it('should return surrounding lines', () => {
    const source = 'line1\nline2\nline3\nline4\nline5';
    const context = getSourceContext(source, 3, 1);

    expect(context.lines).toHaveLength(3);
    expect(context.lines[0]).toEqual({ num: 2, text: 'line2' });
    expect(context.lines[1]).toEqual({ num: 3, text: 'line3' });
    expect(context.lines[2]).toEqual({ num: 4, text: 'line4' });
    expect(context.errorLineIndex).toBe(1);
  });
});

describe('Integration with parser', () => {
  it('should produce ParseError with source context', () => {
    const source = `mission Test {
  source API {
    auth: bearer
  }

  action Fetch {
    get "/items
  }

  run Fetch
}`;

    const lexer = new ReqonLexer(source);

    expect(() => lexer.tokenize()).toThrow();

    try {
      lexer.tokenize();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      const error = e as Error;
      expect(error.message).toContain('Unterminated string');
    }
  });

  it('should produce ParseError for syntax errors', () => {
    const source = `mission Test {
  source API {
    auth: bearer,
    base: "https://api.example.com"
  }

  action Fetch
    get "/items"
  }

  run Fetch
}`;

    const lexer = new ReqonLexer(source);
    const tokens = lexer.tokenize();
    const parser = new ReqonParser(tokens, source, 'test.reqon');

    expect(() => parser.parse()).toThrow();

    try {
      parser.parse();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const error = e as ParseError;
      expect(error.location.line).toBeGreaterThan(0);
      expect(error.context?.source).toBe(source);
      expect(error.context?.filePath).toBe('test.reqon');

      const formatted = error.format();
      expect(formatted).toContain('test.reqon:');
      expect(formatted).toContain('ParseError');
    }
  });
});
