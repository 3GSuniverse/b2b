import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/shell';
import { LinkButton } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';

/** Pages anyone can open without signing in: the home page, Privacy Policy and Terms. */

export function PublicHeader({ sections }: { sections?: { href: string; label: string }[] }) {
  return (
    <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <Link to="/" aria-label={`${BRAND.name} home`}>
        <Logo />
      </Link>
      {sections && (
        <nav aria-label="On this page" className="hidden items-center gap-1 md:flex">
          {sections.map((s) => (
            <a key={s.href} href={s.href} className="rounded-full px-3.5 py-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface hover:text-ink">
              {s.label}
            </a>
          ))}
        </nav>
      )}
      <nav aria-label="Account" className="flex items-center gap-2">
        <LinkButton to="/signin" variant="ghost" size="sm">
          Sign in
        </LinkButton>
        <LinkButton to="/signup" variant="primary" size="sm">
          Start free trial
        </LinkButton>
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-8 text-[13px] text-muted sm:px-6 lg:px-8">
        <span>
          {BRAND.name} is run by {BRAND.operator}.
        </span>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/privacy" className="font-medium hover:text-ink">
            Privacy Policy
          </Link>
          <Link to="/terms" className="font-medium hover:text-ink">
            Terms of Service
          </Link>
          <a href={`mailto:${BRAND.supportEmail}`} className="font-medium hover:text-ink">
            {BRAND.supportEmail}
          </a>
        </nav>
      </div>
    </footer>
  );
}

export type DocSection = { id: string; title: string; body: ReactNode };

/**
 * A long document with a contents list that follows your reading on wide screens.
 * The section you're in is highlighted, and the green marker slides to it.
 */
export function DocPage({ title, intro, summary, sections }: { title: string; intro: ReactNode; summary?: ReactNode; sections: DocSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);

  useEffect(() => {
    document.title = `${title} · ${BRAND.name}`;
    window.scrollTo(0, 0);
    return () => {
      document.title = BRAND.name;
    };
  }, [title]);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  const index = Math.max(0, sections.findIndex((s) => s.id === current));

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <PublicHeader />
      <main className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-[minmax(0,1fr)] gap-12 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8 lg:pt-14">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-8 flex flex-col gap-3">
            <span className="text-[13px] font-semibold text-ink">On this page</span>
            <ol className="relative flex flex-col border-l border-line">
              <span
                aria-hidden
                className="absolute -left-px w-0.5 rounded-full bg-accent transition-[top] duration-500 ease-[cubic-bezier(0.22,1.2,0.36,1)]"
                style={{ top: index * 34 + 6, height: 22 }}
              />
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={cn('block h-[34px] truncate py-2 pl-4 text-[13px] leading-[18px] transition-colors duration-200', s.id === current ? 'font-semibold text-ink' : 'text-muted hover:text-ink')}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article className="doc auth-rise flex max-w-[70ch] flex-col gap-10">
          <header className="flex flex-col gap-3">
            <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">{title}</h1>
            <p className="text-sm text-muted">Last updated {BRAND.legalUpdated}</p>
            <div className="text-[16px] leading-[1.7] text-ink-2">{intro}</div>
          </header>
          {summary && (
            <aside className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 sm:p-6">
              <h2 className="mb-3 text-[15px] font-semibold">The short version</h2>
              <div className="text-[15px] leading-[1.7] text-ink-2">{summary}</div>
            </aside>
          )}
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="flex scroll-mt-8 flex-col gap-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{s.title}</h2>
              <div className="flex flex-col gap-3 text-[15px] leading-[1.75] text-ink-2">{s.body}</div>
            </section>
          ))}
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}
