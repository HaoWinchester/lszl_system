// Independent server-backed regions render as soon as their own read completes.
// Only pending work is coordinated; this is not a persistent data cache.
type Section = { load: () => Promise<any>; apply: (value: any) => void; failed?: (error: unknown) => void };
export function loadSections(sections: Section[]) {
  return Promise.allSettled(sections.map(async section => {
    try { const value = await section.load(); section.apply(value); }
    catch (error) { section.failed?.(error); throw error; }
  }));
}
