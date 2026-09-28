export function create(env: { now: () => number; uuid: () => string; emit: (entry: any) => void }): {
  tick(): void; select(feature: string, identity: string): void; visibility(visible: boolean): void; touch(): void;
};
