import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

const exampleCode = `mission SyncCustomers {
  source API { auth: bearer, base: "https://api.example.com" }
  store customers: file("customers")

  action Fetch {
    get "/customers" {
      paginate: offset(page, 100),
      until: length(response) == 0,
      since: lastSync
    }

    for customer in response {
      map customer -> Customer {
        id: .id,
        name: .name,
        email: lowercase(.email)
      }
      store customer -> customers { key: .id, upsert: true }
    }
  }

  run Fetch
}`;

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{marginLeft: '1rem', color: 'white', borderColor: 'white'}}
            to="/docs/examples">
            View Examples
          </Link>
        </div>
      </div>
    </header>
  );
}

function CodeExample() {
  return (
    <section className={styles.codeExample}>
      <div className="container">
        <div className="row">
          <div className="col col--6">
            <Heading as="h2">Declarative Data Pipelines</Heading>
            <p>
              Define what you want to happen, not how. Reqon handles pagination,
              retries, rate limiting, and error handling automatically.
            </p>
            <ul>
              <li>Automatic pagination with offset, page, or cursor strategies</li>
              <li>Built-in retry with exponential backoff</li>
              <li>Incremental sync with checkpoint tracking</li>
              <li>Pattern matching for error handling</li>
            </ul>
            <Link
              className="button button--primary button--lg"
              to="/docs/getting-started">
              Learn the Syntax
            </Link>
          </div>
          <div className="col col--6">
            <CodeBlock language="typescript" title="sync.vague">
              {exampleCode}
            </CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="Declarative DSL for Data Pipelines"
      description="Reqon is a declarative DSL framework for fetch, map, validate pipelines. Build robust data synchronization with clean, readable syntax.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <CodeExample />
      </main>
    </Layout>
  );
}
