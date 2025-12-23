import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Reqon',
  tagline: 'Declarative DSL for fetch, map, validate pipelines',
  favicon: 'img/favicon.png',

  future: {
    v4: true,
  },

  url: 'https://reqon.dev',
  baseUrl: '/',

  organizationName: 'mcclowes',
  projectName: 'reqon',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/mcclowes/reqon/tree/main/docusaurus/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
          filename: 'sitemap.xml',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    metadata: [
      { name: 'keywords', content: 'reqon, data pipeline, ETL, API sync, declarative DSL, fetch, map, validate' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { property: 'og:type', content: 'website' },
    ],
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Reqon',
      logo: {
        alt: 'Reqon Logo',
        src: 'img/logo-dark.svg',
        srcDark: 'img/logo-light.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/docs/examples',
          label: 'Examples',
          position: 'left',
        },
        {
          to: '/docs/api-reference',
          label: 'API',
          position: 'left',
        },
        {
          href: 'https://github.com/mcclowes/vague',
          label: 'Vague DSL',
          position: 'right',
        },
        {
          href: 'https://github.com/mcclowes/reqon',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      links: [
        {
          title: 'Learn',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'Core Concepts',
              to: '/docs/category/core-concepts',
            },
            {
              label: 'Examples',
              to: '/docs/examples',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'DSL Syntax',
              to: '/docs/category/dsl-syntax',
            },
            {
              label: 'API Reference',
              to: '/docs/api-reference',
            },
            {
              label: 'CLI',
              to: '/docs/cli',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/mcclowes/reqon',
            },
            {
              label: 'Vague DSL',
              href: 'https://github.com/mcclowes/vague',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Reqon. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
