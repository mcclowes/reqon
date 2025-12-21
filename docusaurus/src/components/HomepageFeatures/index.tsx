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
    title: 'Declarative Syntax',
    icon: '📝',
    description: (
      <>
        Write clean, readable pipelines that describe what you want, not how to do it.
        Reqon handles pagination, retries, and error handling automatically.
      </>
    ),
  },
  {
    title: 'Built-in Best Practices',
    icon: '⚡',
    description: (
      <>
        Automatic pagination, exponential backoff, rate limiting, circuit breakers,
        and incremental sync are all built in. No boilerplate required.
      </>
    ),
  },
  {
    title: 'Multiple Auth Methods',
    icon: '🔐',
    description: (
      <>
        Support for OAuth 2.0, Bearer tokens, API keys, and Basic auth.
        Automatic token refresh for OAuth flows.
      </>
    ),
  },
  {
    title: 'OpenAPI Integration',
    icon: '📋',
    description: (
      <>
        Load OpenAPI specs for type-safe API calls. Validate responses against
        schema definitions automatically.
      </>
    ),
  },
  {
    title: 'Flexible Storage',
    icon: '💾',
    description: (
      <>
        Store data in memory, files, SQL (via PostgREST/Supabase), or NoSQL.
        Create custom adapters for any backend.
      </>
    ),
  },
  {
    title: 'Production Ready',
    icon: '🚀',
    description: (
      <>
        Built-in scheduling with cron and intervals. Run as a daemon with
        health checks, metrics, and graceful shutdown.
      </>
    ),
  },
];

function Feature({title, icon, description, index}: FeatureItem & {index: number}) {
  return (
    <div className={clsx('col col--4')} style={{marginBottom: '2rem'}}>
      <div
        className={styles.featureCard}
        style={{'--animation-order': index} as React.CSSProperties}
      >
        <div className={styles.featureIcon}>{icon}</div>
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDescription}>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="text--center margin-bottom--lg">
          <Heading as="h2" className={styles.sectionTitle}>Why Reqon?</Heading>
          <p className={styles.sectionSubtitle}>
            Stop writing boilerplate. Start building data pipelines.
          </p>
        </div>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} index={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
