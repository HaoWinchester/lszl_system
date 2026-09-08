import { resolveIconColor, subscribeAppearance } from '../../domain/appearance';

// All interface icons share a 24-unit canvas and the same optical stroke weight.
const paths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sheet: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  normal: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4ZM20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3Z"/>',
  challenge: '<circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 9v4l3 2m4-10 2 2"/>',
  scholar: '<path d="m2 9 10-5 10 5-10 5ZM6 11v6c4 3 8 3 12 0v-6M22 9v8"/>',
  revenge: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M9 13l2 2 5-5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
};

Component({
  properties: {
    name: { type: String, value: 'chevron' },
    color: { type: String, value: 'ink' },
    size: { type: Number, value: 40 },
  },
  data: { source: '' },
  lifetimes: {
    attached() {
      this.updateSource();
      this.stopAppearance = subscribeAppearance(() => this.updateSource());
    },
    detached() { this.stopAppearance?.(); },
  },
  observers: {
    'name, color'() { this.updateSource(); },
  },
  methods: {
    updateSource() {
      const { name, color } = this.properties;
      const stroke = resolveIconColor(color);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.chevron}</svg>`;
      this.setData({ source: `data:image/svg+xml,${encodeURIComponent(svg)}` });
    },
  },
});

export {};
