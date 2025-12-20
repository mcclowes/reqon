import { TokenType as VagueTokenType } from 'vague-lang';

// Extend Vague's TokenType with Reqon-specific tokens
export enum ReqonTokenType {
  // Reqon keywords
  MISSION = 'MISSION',
  ACTION = 'ACTION',
  SOURCE = 'SOURCE',
  STORE = 'STORE',
  FETCH = 'FETCH',
  RUN = 'RUN',
  FOR = 'FOR',
  MAP = 'MAP',
  EACH = 'EACH',
  PAGINATE = 'PAGINATE',
  UNTIL = 'UNTIL',
  RETRY = 'RETRY',
  KEY = 'KEY',
  PARTIAL = 'PARTIAL',
  UPSERT = 'UPSERT',

  // HTTP methods
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',

  // Store types
  NOSQL = 'NOSQL',
  SQL = 'SQL',
  MEMORY = 'MEMORY',

  // Auth types
  OAUTH2 = 'OAUTH2',
  BEARER = 'BEARER',
  BASIC = 'BASIC',
  API_KEY = 'API_KEY',
  NONE = 'NONE',

  // Pagination types
  OFFSET = 'OFFSET',
  CURSOR = 'CURSOR',
  PAGE = 'PAGE',

  // Additional operators
  RIGHT_ARROW = 'RIGHT_ARROW', // ->

  // OAS integration
  FROM = 'FROM',

  // Scheduling
  SCHEDULE = 'SCHEDULE',
  CRON = 'CRON',
  EVERY = 'EVERY',
  AT = 'AT',
  HOURS = 'HOURS',
  MINUTES = 'MINUTES',
  SECONDS = 'SECONDS',
  DAYS = 'DAYS',
  WEEKS = 'WEEKS',
}

// Combined token type
export type TokenType = VagueTokenType | ReqonTokenType;

// Re-export Vague's TokenType for convenience
export { TokenType as VagueTokenType } from 'vague-lang';

// Reqon-specific keywords
export const REQON_KEYWORDS: Record<string, ReqonTokenType> = {
  mission: ReqonTokenType.MISSION,
  action: ReqonTokenType.ACTION,
  source: ReqonTokenType.SOURCE,
  store: ReqonTokenType.STORE,
  fetch: ReqonTokenType.FETCH,
  run: ReqonTokenType.RUN,
  for: ReqonTokenType.FOR,
  map: ReqonTokenType.MAP,
  each: ReqonTokenType.EACH,
  paginate: ReqonTokenType.PAGINATE,
  until: ReqonTokenType.UNTIL,
  retry: ReqonTokenType.RETRY,
  key: ReqonTokenType.KEY,
  partial: ReqonTokenType.PARTIAL,
  upsert: ReqonTokenType.UPSERT,

  // HTTP methods (case insensitive in parsing, but stored as tokens)
  GET: ReqonTokenType.GET,
  POST: ReqonTokenType.POST,
  PUT: ReqonTokenType.PUT,
  PATCH: ReqonTokenType.PATCH,
  DELETE: ReqonTokenType.DELETE,

  // Store types
  nosql: ReqonTokenType.NOSQL,
  sql: ReqonTokenType.SQL,
  memory: ReqonTokenType.MEMORY,

  // Auth types
  oauth2: ReqonTokenType.OAUTH2,
  bearer: ReqonTokenType.BEARER,
  basic: ReqonTokenType.BASIC,
  api_key: ReqonTokenType.API_KEY,
  none: ReqonTokenType.NONE,

  // Pagination types
  offset: ReqonTokenType.OFFSET,
  cursor: ReqonTokenType.CURSOR,
  page: ReqonTokenType.PAGE,

  // OAS integration
  from: ReqonTokenType.FROM,

  // Scheduling
  schedule: ReqonTokenType.SCHEDULE,
  cron: ReqonTokenType.CRON,
  every: ReqonTokenType.EVERY,
  at: ReqonTokenType.AT,
  hours: ReqonTokenType.HOURS,
  minutes: ReqonTokenType.MINUTES,
  seconds: ReqonTokenType.SECONDS,
  days: ReqonTokenType.DAYS,
  weeks: ReqonTokenType.WEEKS,
};

export interface ReqonToken {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}
