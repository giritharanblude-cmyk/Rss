export type SettingsRepository = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};
