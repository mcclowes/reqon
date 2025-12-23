import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Declarative syntax',
    icon: '📝',
    description: (
      <>
        Write clean, readable pipelines that describe what you want, not how to do it.
        Reqon handles pagination, retries, and error handling automatically.
      </>
    ),
  },
  {
    title: 'Built-in best practices',
    icon: '⚡',
    description: (
      <>
        Automatic pagination, exponential backoff, rate limiting, circuit breakers,
        and incremental sync are all built in. No boilerplate required.
      </>
    ),
  },
  {
    title: 'Multiple auth methods',
    icon: '🔐',
    description: (
      <>
        Support for OAuth 2.0, Bearer tokens, API keys, and Basic auth.
        Automatic token refresh for OAuth flows.
      </>
    ),
  },
  {
    title: 'OpenAPI integration',
    icon: '📋',
    description: (
      <>
        Load OpenAPI specs for type-safe API calls. Validate responses against
        schema definitions automatically.
      </>
    ),
  },
  {
    title: 'Flexible storage',
    icon: '💾',
    description: (
      <>
        Store data in memory, files, SQL (via PostgREST/Supabase), or NoSQL.
        Create custom adapters for any backend.
      </>
    ),
  },
  {
    title: 'Production ready',
    icon: '🚀',
    description: (
      <>
        Built-in scheduling with cron and intervals. Run as a daemon with
        health checks, metrics, and graceful shutdown.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <div className={styles.featureIcon}>{icon}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="text--center margin-bottom--xl">
          <Heading as="h2">Why Reqon?</Heading>
          <p className="hero__subtitle">
            Stop writing boilerplate. Start building data pipelines.
          </p>
        </div>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
