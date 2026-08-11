import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';

import styles from './styles.module.css';

const features = [
  {
    marker: '01',
    title: 'Fetch without babysitting',
    description: 'Cursor, page, and offset pagination. Retries, backoff, rate limits, and circuit breakers are part of the language.',
    tags: ['Pagination', 'Retries', 'Rate limits'],
  },
  {
    marker: '02',
    title: 'Transform in plain sight',
    description: 'Map, validate, and branch with readable expressions. The pipeline stays close to the shape of your data.',
    tags: ['Mapping', 'Validation', 'Matching'],
  },
  {
    marker: '03',
    title: 'Resume where you stopped',
    description: 'Durable checkpoints, incremental sync, and execution traces make long-running jobs safe to restart and easy to inspect.',
    tags: ['Checkpoints', 'Tracing', 'Scheduling'],
  },
];

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.intro}>
          <div>
            <span className={styles.label}>One language, the whole pipeline</span>
            <Heading as="h2">Less glue code.<br />More visible intent.</Heading>
          </div>
          <p>
            Reqon turns the repetitive parts of API integration into readable
            declarations. Pipelines stay small enough to review and explicit enough to trust.
          </p>
        </div>

        <div className={styles.grid}>
          {features.map((feature) => (
            <article className={styles.card} key={feature.marker}>
              <span className={styles.marker}>{feature.marker}</span>
              <Heading as="h3">{feature.title}</Heading>
              <p>{feature.description}</p>
              <div className={styles.tags}>
                {feature.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </article>
          ))}
        </div>

        <div className={styles.foundation}>
          <span>Works with the systems you already have</span>
          <div>
            <Link to="/docs/authentication/overview">OAuth 2.0</Link>
            <Link to="/docs/openapi/overview">OpenAPI</Link>
            <Link to="/docs/stores/postgrest">PostgREST</Link>
            <Link to="/docs/observability/opentelemetry">OpenTelemetry</Link>
            <Link to="/docs/advanced/mcp-integration">MCP</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
