import { z } from 'zod';

export const browserConfigSchema = z.object({
  VITE_APP_NAME: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).default('PortfolioPilot')),
  VITE_DATA_MODE: z.preprocess((v) => v === '' ? undefined : v, z.enum(['mock', 'live']).default('mock'))
}).strict();
export type BrowserConfig = z.infer<typeof browserConfigSchema>;
export function parseBrowserConfig(input: unknown): BrowserConfig {
  return browserConfigSchema.parse(input);
}
