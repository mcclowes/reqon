import siteConfig from '@generated/docusaurus.config';

export default function prismIncludeLanguages(PrismObject: typeof globalThis.Prism): void {
  const {
    themeConfig: { prism },
  } = siteConfig;

  const { additionalLanguages } = prism as { additionalLanguages: string[] };

  // Load additional languages from config
  globalThis.Prism = PrismObject;
  additionalLanguages.forEach((lang: string) => {
    if (lang === 'php') {
      // PHP requires markup-templating
      require('prismjs/components/prism-markup-templating');
    }
    require(`prismjs/components/prism-${lang}`);
  });

  // Register custom Vague/Reqon language
  PrismObject.languages.vague = {
    comment: {
      pattern: /\/\/.*|\/\*[\s\S]*?\*\//,
      greedy: true,
    },
    string: {
      pattern: /"(?:\\.|[^"\\])*"/,
      greedy: true,
    },
    keyword: /\b(?:mission|source|store|schema|action|run|then|get|post|put|patch|delete|call|for|in|where|map|validate|match|assume|if|else|let|abort|skip|continue|retry|jump|queue|wait|schedule|every|cron|at|and|or|not|is|from)\b/,
    builtin: /\b(?:auth|base|headers|params|body|paginate|until|since|retry|key|upsert|partial|offset|page|cursor|lastSync|response|env|true|false|null|none|bearer|basic|api_key|oauth2|memory|file|sql|nosql|postgrest|exponential|linear|constant)\b/,
    function: /\b(?:length|concat|substring|lowercase|uppercase|toString|toNumber|now|uuid)\b(?=\s*\()/,
    number: /\b\d+(?:\.\d+)?\b/,
    operator: /->|=>|==|!=|<=|>=|<|>|\+|-|\*|\/|\.{3}|\./,
    punctuation: /[{}[\](),;:]/,
  };

  // Also register as 'reqon' alias
  PrismObject.languages.reqon = PrismObject.languages.vague;

  delete globalThis.Prism;
}
