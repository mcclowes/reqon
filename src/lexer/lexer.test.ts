import { describe, it, expect } from 'vitest';
import { Lexer as ReqonLexer, TokenType, type Token } from './index.js';
import { ReqonTokenType } from './tokens.js';

describe('ReqonLexer', () => {
  describe('string tokenization', () => {
    it('tokenizes simple strings', () => {
      const lexer = new ReqonLexer('"hello world"');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe('hello world');
    });

    it('handles escape sequences', () => {
      const lexer = new ReqonLexer('"line1\\nline2"');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe('line1\nline2');
    });

    it('handles tab escape sequence', () => {
      const lexer = new ReqonLexer('"col1\\tcol2"');
      const tokens = lexer.tokenize();

      expect(tokens[0].value).toBe('col1\tcol2');
    });

    it('handles escaped quotes', () => {
      const lexer = new ReqonLexer('"say \\"hello\\""');
      const tokens = lexer.tokenize();

      expect(tokens[0].value).toBe('say "hello"');
    });

    it('handles escaped backslash', () => {
      const lexer = new ReqonLexer('"path\\\\to\\\\file"');
      const tokens = lexer.tokenize();

      expect(tokens[0].value).toBe('path\\to\\file');
    });

    it('throws on unterminated string', () => {
      const lexer = new ReqonLexer('"unterminated');

      expect(() => lexer.tokenize()).toThrow('Unterminated string');
    });
  });

  describe('number tokenization', () => {
    it('tokenizes integers', () => {
      const lexer = new ReqonLexer('42');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe('42');
    });

    it('tokenizes decimals', () => {
      const lexer = new ReqonLexer('3.14159');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe('3.14159');
    });

    it('tokenizes numbers with leading zero', () => {
      const lexer = new ReqonLexer('0.5');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe('0.5');
    });
  });

  describe('keyword tokenization', () => {
    it('recognizes Reqon keywords', () => {
      const lexer = new ReqonLexer('mission action source store call run');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.MISSION);
      expect(tokens[1].type).toBe(ReqonTokenType.ACTION);
      expect(tokens[2].type).toBe(ReqonTokenType.SOURCE);
      expect(tokens[3].type).toBe(ReqonTokenType.STORE);
      expect(tokens[4].type).toBe(ReqonTokenType.CALL);
      expect(tokens[5].type).toBe(ReqonTokenType.RUN);
    });

    it('recognizes HTTP method keywords', () => {
      const lexer = new ReqonLexer('GET POST PUT PATCH DELETE');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.GET);
      expect(tokens[1].type).toBe(ReqonTokenType.POST);
      expect(tokens[2].type).toBe(ReqonTokenType.PUT);
      expect(tokens[3].type).toBe(ReqonTokenType.PATCH);
      expect(tokens[4].type).toBe(ReqonTokenType.DELETE);
    });

    it('recognizes auth type keywords', () => {
      const lexer = new ReqonLexer('oauth2 bearer basic api_key');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.OAUTH2);
      expect(tokens[1].type).toBe(ReqonTokenType.BEARER);
      expect(tokens[2].type).toBe(ReqonTokenType.BASIC);
      expect(tokens[3].type).toBe(ReqonTokenType.API_KEY);
    });

    it('recognizes Vague keywords', () => {
      const lexer = new ReqonLexer('match where and or not true false null');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.MATCH);
      expect(tokens[1].type).toBe(TokenType.WHERE);
      expect(tokens[2].type).toBe(TokenType.AND);
      expect(tokens[3].type).toBe(TokenType.OR);
      expect(tokens[4].type).toBe(TokenType.NOT);
      expect(tokens[5].type).toBe(TokenType.TRUE);
      expect(tokens[6].type).toBe(TokenType.FALSE);
      expect(tokens[7].type).toBe(TokenType.NULL);
    });

    it('treats unknown words as identifiers', () => {
      const lexer = new ReqonLexer('myVariable anotherOne');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[0].value).toBe('myVariable');
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].value).toBe('anotherOne');
    });
  });

  describe('operator tokenization', () => {
    it('recognizes right arrow operator', () => {
      const lexer = new ReqonLexer('map item -> Output');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.MAP);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[2].type).toBe(TokenType.RIGHT_ARROW);
      expect(tokens[3].type).toBe(TokenType.IDENTIFIER);
    });

    it('recognizes two-character operators', () => {
      const lexer = new ReqonLexer('== <= >= => ..');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.DOUBLE_EQUALS);
      expect(tokens[1].type).toBe(TokenType.LTE);
      expect(tokens[2].type).toBe(TokenType.GTE);
      expect(tokens[3].type).toBe(TokenType.ARROW);
      expect(tokens[4].type).toBe(TokenType.DOTDOT);
    });

    it('recognizes single-character operators', () => {
      const lexer = new ReqonLexer('+ - * / : = < > . , ( ) { } [ ]');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.PLUS);
      expect(tokens[1].type).toBe(TokenType.MINUS);
      expect(tokens[2].type).toBe(TokenType.STAR);
      expect(tokens[3].type).toBe(TokenType.SLASH);
      expect(tokens[4].type).toBe(TokenType.COLON);
      expect(tokens[5].type).toBe(TokenType.EQUALS);
      expect(tokens[6].type).toBe(TokenType.LT);
      expect(tokens[7].type).toBe(TokenType.GT);
      expect(tokens[8].type).toBe(TokenType.DOT);
      expect(tokens[9].type).toBe(TokenType.COMMA);
      expect(tokens[10].type).toBe(TokenType.LPAREN);
      expect(tokens[11].type).toBe(TokenType.RPAREN);
      expect(tokens[12].type).toBe(TokenType.LBRACE);
      expect(tokens[13].type).toBe(TokenType.RBRACE);
      expect(tokens[14].type).toBe(TokenType.LBRACKET);
      expect(tokens[15].type).toBe(TokenType.RBRACKET);
    });

    it('throws on unexpected character', () => {
      const lexer = new ReqonLexer('@');

      expect(() => lexer.tokenize()).toThrow("Unexpected character '@'");
    });
  });

  describe('comments', () => {
    it('skips single-line comments', () => {
      const lexer = new ReqonLexer('mission // this is a comment\nTestMission');
      const tokens = lexer.tokenize();

      // Should have: MISSION, NEWLINE, IDENTIFIER, EOF
      expect(tokens.filter((t: Token) => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF))
        .toHaveLength(2);
      expect(tokens[0].type).toBe(ReqonTokenType.MISSION);
      expect(tokens[2].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[2].value).toBe('TestMission');
    });

    it('handles comment at end of file', () => {
      const lexer = new ReqonLexer('mission // end comment');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.MISSION);
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
    });
  });

  describe('line and column tracking', () => {
    it('tracks line numbers', () => {
      const lexer = new ReqonLexer('mission\nTestMission\n{\n}');
      const tokens = lexer.tokenize();

      expect(tokens[0].line).toBe(1); // mission
      expect(tokens[2].line).toBe(2); // TestMission
      expect(tokens[4].line).toBe(3); // {
      expect(tokens[6].line).toBe(4); // }
    });

    it('tracks column numbers', () => {
      const lexer = new ReqonLexer('mission TestMission');
      const tokens = lexer.tokenize();

      expect(tokens[0].column).toBe(1); // mission starts at column 1
      expect(tokens[1].column).toBe(9); // TestMission starts at column 9
    });

    it('resets column after newline', () => {
      const lexer = new ReqonLexer('abc\nxyz');
      const tokens = lexer.tokenize();

      expect(tokens[0].column).toBe(1); // abc
      expect(tokens[2].column).toBe(1); // xyz
    });
  });

  describe('complex tokenization', () => {
    it('tokenizes a complete mission definition', () => {
      const source = `
        mission SyncUsers {
          source API {
            auth: bearer,
            base: "https://api.example.com"
          }

          store users: memory("users")

          action FetchUsers {
            get "/users"
            store response -> users {
              key: .id
            }
          }

          run FetchUsers
        }
      `;

      const lexer = new ReqonLexer(source);
      const tokens = lexer.tokenize();

      // Verify it doesn't throw and produces tokens
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);

      // Check key tokens are present
      const tokenTypes = tokens.map((t: Token) => t.type);
      expect(tokenTypes).toContain(ReqonTokenType.MISSION);
      expect(tokenTypes).toContain(ReqonTokenType.SOURCE);
      expect(tokenTypes).toContain(ReqonTokenType.STORE);
      expect(tokenTypes).toContain(ReqonTokenType.ACTION);
      expect(tokenTypes).toContain(ReqonTokenType.GET);
      expect(tokenTypes).toContain(ReqonTokenType.RUN);
    });

    it('tokenizes pagination options', () => {
      const lexer = new ReqonLexer('paginate offset page cursor until retry');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.PAGINATE);
      expect(tokens[1].type).toBe(ReqonTokenType.OFFSET);
      expect(tokens[2].type).toBe(ReqonTokenType.PAGE);
      expect(tokens[3].type).toBe(ReqonTokenType.CURSOR);
      expect(tokens[4].type).toBe(ReqonTokenType.UNTIL);
      expect(tokens[5].type).toBe(ReqonTokenType.RETRY);
    });

    it('tokenizes store options', () => {
      const lexer = new ReqonLexer('key partial upsert');
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(ReqonTokenType.KEY);
      expect(tokens[1].type).toBe(ReqonTokenType.PARTIAL);
      expect(tokens[2].type).toBe(ReqonTokenType.UPSERT);
    });
  });

  describe('whitespace handling', () => {
    it('skips spaces and tabs', () => {
      const lexer = new ReqonLexer('   mission   \t  action   ');
      const tokens = lexer.tokenize();

      const nonEofTokens = tokens.filter((t: Token) => t.type !== TokenType.EOF);
      expect(nonEofTokens).toHaveLength(2);
      expect(nonEofTokens[0].type).toBe(ReqonTokenType.MISSION);
      expect(nonEofTokens[1].type).toBe(ReqonTokenType.ACTION);
    });

    it('tracks newlines as tokens', () => {
      const lexer = new ReqonLexer('a\nb\nc');
      const tokens = lexer.tokenize();

      expect(tokens.filter((t: Token) => t.type === TokenType.NEWLINE)).toHaveLength(2);
    });
  });
});
