import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import HomepageFeatures from '@site/src/components/HomepageFeatures';
import styles from './index.module.css';

const heroCode = [
  [<><span className={styles.keyword}>mission</span> SyncCustomers {'{'}</>, ''],
  [<><span className={styles.keyword}>source</span> API {'{'}</>, '  '],
  [<>auth: <span className={styles.value}>bearer</span>,</>, '    '],
  [<>base: <span className={styles.string}>&quot;https://api.example.com&quot;</span></>, '    '],
  [<> {'}'}</>, '  '],
  ['', ''],
  [<><span className={styles.keyword}>action</span> Fetch {'{'}</>, '  '],
  [<><span className={styles.method}>get</span> <span className={styles.string}>&quot;/customers&quot;</span> {'{'}</>, '    '],
  [<>paginate: offset(page, <span className={styles.number}>100</span>),</>, '      '],
  [<>retry: exponential(<span className={styles.number}>3</span>)</>, '      '],
  [<> {'}'}</>, '    '],
  [<> {'}'}</>, '  '],
  ['', ''],
  [<><span className={styles.keyword}>run</span> Fetch</>, '  '],
  [<> {'}'}</>, ''],
] as const;

function CodeWindow(): ReactNode {
  return (
    <div className={styles.codeWindow} aria-label="Reqon pipeline example">
      <div className={styles.codeHeader}>
        <span className={styles.windowControls} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>sync-customers.vague</span>
        <span className={styles.running}>Ready</span>
      </div>
      <pre className={styles.code}>
        <code>
          {heroCode.map(([content, indent], index) => (
            <span className={styles.codeLine} key={index}>
              <span className={styles.lineNumber}>{index + 1}</span>
              <span>{indent}{content}</span>
            </span>
          ))}
        </code>
      </pre>
      <div className={styles.codeFooter}>
        <span><i className={styles.statusDot} /> Synced 2,481 records</span>
        <span>1.8s</span>
      </div>
    </div>
  );
}

function HomepageHeader(): ReactNode {
  return (
    <header className={styles.heroBanner}>
      <div className={`container ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Data pipelines, without the plumbing</div>
          <Heading as="h1">
            Describe the data flow.<br />
            <span>Reqon runs the rest.</span>
          </Heading>
          <p className={styles.heroSubtitle}>
            A declarative DSL for fetching, transforming, and validating API data.
            Pagination, retries, auth, and checkpoints come built in.
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/docs/getting-started">
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link className={`button button--lg ${styles.ghostButton}`} to="/docs/examples">
              Browse examples
            </Link>
          </div>
          <div className={styles.installCommand}>
            <span aria-hidden="true">$</span>
            <code>npm install reqon</code>
          </div>
        </div>
        <CodeWindow />
      </div>
    </header>
  );
}

function ClosingCta(): ReactNode {
  return (
    <section className={styles.closingCta}>
      <div className={`container ${styles.closingInner}`}>
        <div>
          <span className={styles.sectionLabel}>Start small, scale cleanly</span>
          <Heading as="h2">Your next sync fits in one file.</Heading>
        </div>
        <Link className="button button--primary button--lg" to="/docs/getting-started">
          Read the quickstart <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Declarative data pipelines"
      description="Reqon is a declarative DSL for fetching, transforming, and validating API data, with pagination, retries, auth, and checkpoints built in.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <ClosingCta />
      </main>
    </Layout>
  );
}
