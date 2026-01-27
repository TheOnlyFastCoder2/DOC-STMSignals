import { type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
// import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import $ from './index.module.css';

import './reactScan.js';
import Notifications from '../components/Notifications';
import Media from '../components/Media';
import srcVideo from './video.webm';
import { Spring } from '../_stm/react/animation/Spring';
import { Sig, useSignal } from '../_stm/react/react';
import { signal } from '../_stm';
function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  const isActive = useSignal(true);
  return (
    <header className={clsx('hero hero--primary', $.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={$.heroTitle}>
          <Text isActive={isActive}>{siteConfig.title}</Text>
        </Heading>

        <p className={$.heroSubtitle}>
          <SubtitleReveal isActive={isActive} delayMs={380}>
            {siteConfig.tagline}
          </SubtitleReveal>
        </p>
        <div className={$.buttons}>
          <Link className={$.heroButton} to="/docs/intro">
            В путь — мир без боли
          </Link>

          <Link
            className={$.heroButton}
            to="https://github.com/TheOnlyFastCoder2/DOC-STMSignals/tree/main/src/_stm"
          >
            ссылка на beta stm
          </Link>
        </div>
        <div className={$.video}>
          <Media src={srcVideo} type="video" />
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Description will go into a meta tag in <head />"
    >
      <Notifications />

      <HomepageHeader />
    </Layout>
  );
}

interface TextProps {
  children: string;
  delay?: number;
  startPos?: number;
  isFollow?: boolean;

  stiffnessTop?: number;
  dampingTop?: number;

  stiffnessCenter?: number;
  dampingCenter?: number;
  isActive?: Sig<boolean>;
  isHover?: boolean;
  className?: string;
  onEnd?: () => void;
}

export function Text({
  children,
  isActive,
  delay = 40,
  isFollow = true,

  stiffnessTop = 90,
  dampingTop = 10,

  stiffnessCenter = 90,
  dampingCenter = 10,
  startPos = 0,
  isHover = true,
  className = '',
  onEnd,
}: TextProps) {
  const toFollow = isFollow ? 1 : 0;
  const config1 = { stiffness: stiffnessTop, damping: dampingTop } as any;
  const config2 = { stiffness: stiffnessCenter, damping: dampingCenter } as any;
  const transformStyle = { values: { default: 'preserve-3d', active: 'preserve-3d' } };

  const _StartPos = useSignal(startPos);
  const _isHover = useSignal(false);

  const active = {
    get v() {
      const base = isActive?.v ?? false;
      return isHover && _isHover.v ? !base : base;
    },
  };

  return (
    <div
      className={`${$.Text} ${className}`}
      onMouseEnter={() => {
        if (_isHover.v) return;
        _isHover.v = true;
        _StartPos.v = 0;
        config1.delay = config2.delay = 0;
      }}
    >
      {children.split('').map((char, ind) => {
        const index = () => (ind + _StartPos.u) * toFollow;
        const toDelay = () => index() * delay;
        const toDelay2 = () => index() * delay;
        config1.delay = toDelay;
        config2.delay = toDelay2;

        return (
          <span key={ind} className={$.Text_char}>
            <Spring
              className={`${$.Text_spring} ${$.originTop}`}
              children={<span>{char}</span>}
              isActive={active}
              settleKey="translateY"
              spring={{
                transformStyle,
                translateY: { ...config1, values: { default: 0, active: `-50%` } },
                opacity: { ...config1, values: { default: 1, active: 0 } },
                rotateX: { ...config1, values: { default: 0, active: -90 } },
              }}
            />
            <Spring
              className={`${$.Text_spring} ${$.originCenter}`}
              children={<span>{char}</span>}
              isActive={active}
              spring={{
                transformStyle,
                translateY: { ...config1, values: { default: `50%`, active: 0 } },
                opacity: { ...config2, values: { default: 0, active: 1 } },
                rotateX: {
                  ...config2,
                  values: { default: 90, active: 0 },

                  stiffness: 20,
                },
              }}
              settleKey="translateY"
              onPhaseProgress={(_, percent) => {
                if (ind >= children.length - 1 && percent > 0.95) {
                  _isHover.v = false;
                  _StartPos.v = startPos;
                  onEnd?.();
                }
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

function SubtitleReveal({
  children,
  isActive,
  delayMs = 280,
}: {
  children: string;
  isActive?: Sig<boolean>;
  delayMs?: number;
}) {
  return (
    <Spring
      isActive={isActive}
      className={$.SubtitleSpring}
      classInner={$.SubtitleSpringInner}
      spring={{
        opacity: {
          stiffness: 120,
          damping: 18,
          delay: delayMs,
          values: { default: 0, active: 1 },
        },
        translateY: {
          stiffness: 140,
          damping: 16,
          delay: delayMs,
          values: { default: '80%', active: '0%' },
        },
        rotateX: {
          stiffness: 140,
          damping: 20,
          delay: delayMs,
          values: { default: 25, active: 0 },
        },
        scale: {
          stiffness: 160,
          damping: 18,
          delay: delayMs,
          values: { default: 0.98, active: 1 },
        },
      }}
    >
      <span>{children}</span>
    </Spring>
  );
}
