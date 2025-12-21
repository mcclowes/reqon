import { TokenType as VagueTokenType } from 'vague-lang';

// Extend Vague's TokenType with Reqon-specific tokens
export enum ReqonTokenType {
  // Reqon keywords
  MISSION = 'MISSION',
  ACTION = 'ACTION',
  SOURCE = 'SOURCE',
  STORE = 'STORE',
  CALL = 'CALL',
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
  SINCE = 'SINCE',
  LAST_SYNC = 'LAST_SYNC',

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

  // Additional operators (RIGHT_ARROW is now in Vague)
  NOT_EQUALS = 'NOT_EQUALS', // !=
  BANG = 'BANG', // !
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

  // Flow control directives
  CONTINUE = 'CONTINUE',
  SKIP = 'SKIP',
  ABORT = 'ABORT',
  QUEUE = 'QUEUE',
  JUMP = 'JUMP',

  // Type checking
  IS = 'IS',

  // Transforms
  TRANSFORM = 'TRANSFORM',
  APPLY = 'APPLY',
  TO = 'TO',
  AS = 'AS',
  TRY = 'TRY',

  // Webhook support
  WAIT = 'WAIT',
  TIMEOUT = 'TIMEOUT',
  PATH = 'PATH',
  EXPECTED_EVENTS = 'EXPECTED_EVENTS',
  EVENT_FILTER = 'EVENT_FILTER',
  STORAGE = 'STORAGE',
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
  call: ReqonTokenType.CALL,
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
  since: ReqonTokenType.SINCE,
  lastSync: ReqonTokenType.LAST_SYNC,

  // HTTP methods (both lowercase and uppercase)
  get: ReqonTokenType.GET,
  post: ReqonTokenType.POST,
  put: ReqonTokenType.PUT,
  patch: ReqonTokenType.PATCH,
  delete: ReqonTokenType.DELETE,
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

  // Flow control directives
  continue: ReqonTokenType.CONTINUE,
  skip: ReqonTokenType.SKIP,
  abort: ReqonTokenType.ABORT,
  queue: ReqonTokenType.QUEUE,
  jump: ReqonTokenType.JUMP,

  // Type checking
  is: ReqonTokenType.IS,

  // Transforms
  transform: ReqonTokenType.TRANSFORM,
  apply: ReqonTokenType.APPLY,
  to: ReqonTokenType.TO,
  as: ReqonTokenType.AS,
  try: ReqonTokenType.TRY,

  // Webhook support
  wait: ReqonTokenType.WAIT,
  timeout: ReqonTokenType.TIMEOUT,
  path: ReqonTokenType.PATH,
  expectedEvents: ReqonTokenType.EXPECTED_EVENTS,
  eventFilter: ReqonTokenType.EVENT_FILTER,
  storage: ReqonTokenType.STORAGE,
};

// ReqonToken is now an alias for Vague's Token
// Token type can be a string (for plugin-registered keywords)
export interface ReqonToken {
  type: TokenType | string;
  value: string;
  line: number;
  column: number;
}
