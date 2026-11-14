/**
 * The three behaviours the page needs, and nothing else.
 *
 * The theme is applied by an inline script in `<head>` instead of here, because
 * it has to run before the first paint. Everything in this file can wait for the
 * module to load: none of it affects what is visible on arrival.
 */

const THEME_KEY = 'hilbras-sdk-theme';

function setupThemeToggle(): void {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable — private mode, blocked cookies. The toggle
      // still works for this page view, it just will not be remembered.
    }
  });
}

function setupReveal(): void {
  const reveals = document.querySelectorAll<HTMLElement>('.reveal');
  if (reveals.length === 0) return;

  const showAll = (): void => {
    for (const node of reveals) node.classList.add('in');
  };

  // The CSS only hides these under `.js` and only for readers who have not asked
  // for reduced motion, so a failure here must reveal the page rather than
  // leave it blank.
  try {
    if (!('IntersectionObserver' in window)) {
      showAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );

    for (const node of reveals) observer.observe(node);
  } catch {
    showAll();
  }
}

function setupProgress(): void {
  const progress = document.getElementById('progress');
  if (!progress) return;

  let queued = false;
  const paint = (): void => {
    queued = false;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
    progress.style.setProperty('--progress', String(Math.min(1, Math.max(0, ratio))));
  };

  // Coalesced through rAF: a fast flick fires far more scroll events than there
  // are frames to draw them in.
  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    },
    { passive: true },
  );
  window.addEventListener('resize', paint, { passive: true });

  progress.classList.add('live');
  paint();
}

/**
 * The continuous animations are declared paused and started only while the thing
 * they animate is on screen. Without this, five infinite keyframes keep the main
 * thread busy on every scroll and battery budget, for elements that are mostly
 * off screen — Lighthouse put that cost at 3.0s of blocking on a throttled phone.
 *
 * The selectors are repeated here rather than marked up in the page: they are the
 * same set the motion section's `.in-view` rules name, and adding a data
 * attribute to seven different elements to express the same thing is noise.
 */
function setupAnimationGating(): void {
  const animated = document.querySelectorAll<HTMLElement>(
    '.hero-glow, .gold-text, .eyebrow-dot, .marquee, .hero-window',
  );
  if (animated.length === 0) return;

  if (!('IntersectionObserver' in window)) {
    for (const node of animated) node.classList.add('in-view');
    return;
  }

  // The margin starts an element moving just before it scrolls into frame, so it
  // does not visibly snap into motion at the edge.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      }
    },
    { rootMargin: '160px' },
  );

  for (const node of animated) observer.observe(node);
}

function setupYear(): void {
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}

setupThemeToggle();
setupReveal();
setupProgress();
setupAnimationGating();
setupYear();
