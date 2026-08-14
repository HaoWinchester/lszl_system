(function landingPageBootstrap() {
  'use strict';

  const root = document.documentElement;
  const header = document.querySelector('[data-landing-header]');
  const nav = document.querySelector('[data-landing-nav]');
  const navToggle = document.querySelector('[data-landing-nav-toggle]');
  const tabs = Array.from(document.querySelectorAll('[data-product-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-product-panel]'));
  const faqTriggers = Array.from(document.querySelectorAll('[data-faq-trigger]'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  root.classList.add('is-enhanced');

  function setMenu(open) {
    if (!header || !navToggle) return;
    const next = Boolean(open);
    header.classList.toggle('is-menu-open', next);
    navToggle.setAttribute('aria-expanded', String(next));
    navToggle.setAttribute('aria-label', next ? '关闭导航菜单' : '打开导航菜单');
  }

  function selectProduct(tab, focus) {
    if (!tab) return;
    const product = tab.dataset.productTab;
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.classList.toggle('is-active', selected);
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      const selected = panel.dataset.productPanel === product;
      panel.classList.toggle('is-active', selected);
      panel.hidden = !selected;
    });
    if (focus) tab.focus();
  }

  function setFaq(trigger, expanded) {
    const details = trigger && trigger.closest('details');
    if (!details) return;
    if (details.open !== Boolean(expanded)) details.open = Boolean(expanded);
    trigger.setAttribute('aria-expanded', String(Boolean(expanded)));
  }

  function productAt(index) {
    const normalized = (index + tabs.length) % tabs.length;
    return tabs[normalized];
  }

  navToggle?.addEventListener('click', () => {
    setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
  });

  nav?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });

  document.addEventListener('click', (event) => {
    if (!header?.classList.contains('is-menu-open')) return;
    if (!header.contains(event.target)) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectProduct(tab, false));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = productAt(index + 1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = productAt(index - 1);
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      selectProduct(next, true);
    });
  });

  panels.forEach((panel) => {
    const tab = tabs.find((candidate) => candidate.dataset.productTab === panel.dataset.productPanel);
    panel.hidden = tab?.getAttribute('aria-selected') !== 'true';
  });

  faqTriggers.forEach((trigger) => {
    const details = trigger.closest('details');
    setFaq(trigger, details?.open);
    details?.addEventListener('toggle', () => setFaq(trigger, details.open));
  });

  document.querySelectorAll('[data-product-image]').forEach((image) => {
    image.addEventListener('error', () => {
      image.hidden = true;
      image.closest('.landing-product-media')?.querySelector('[data-image-fallback]')?.classList.add('is-visible');
    });
  });

  function updateHeader() {
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
  }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const revealItems = Array.from(document.querySelectorAll('[data-reveal]'));
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach((item) => observer.observe(item));
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setMenu(false);
  });
}());
