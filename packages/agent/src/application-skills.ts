import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { AgentConfigurationError } from './errors.js';

export const APPLICATION_SKILLS = ['daily-portfolio-briefing', 'earnings-news-review'] as const;
export type ApplicationSkill = typeof APPLICATION_SKILLS[number];
export const APPLICATION_RUNTIME_VERSION = 'skills-policy-v1';
export const BRIEFING_HEADINGS = ['As of and coverage', 'Portfolio snapshot', 'Relevant news', 'Risks and uncertainties', 'Research follow-ups'] as const;
export const EARNINGS_HEADINGS = ['Reported earnings facts', 'Portfolio exposure', 'Interpretation and counterarguments', 'Uncertainties and follow-up research'] as const;

export async function skillInstructions(skill: ApplicationSkill): Promise<string> {
  if (skill === 'daily-portfolio-briefing') return readFile(new URL('../runtime/skills/daily-portfolio-briefing/SKILL.md', import.meta.url), 'utf8');
  return readFile(new URL('../runtime/skills/earnings-news-review/SKILL.md', import.meta.url), 'utf8');
}
async function exists(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Fail on unmanaged configuration; never overwrite an existing instruction or follow symlinks. */
export async function prepareApplicationSkills(workspace: string): Promise<void> {
  for (const name of ['settings.json', 'settings.local.json', 'CLAUDE.md', 'agents', 'commands', 'plugins', '.claude']) {
    if (await exists(join(/* turbopackIgnore: true */ workspace, name))) throw new AgentConfigurationError('Unexpected application runtime configuration. Use a dedicated clean AGENT_WORKSPACE_DIR.');
  }
  const root = join(/* turbopackIgnore: true */ workspace, 'skills');
  if ((await exists(root))?.isSymbolicLink()) throw new AgentConfigurationError('Runtime skills cannot be symbolic links.');
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) if (!APPLICATION_SKILLS.includes(entry as ApplicationSkill))
    throw new AgentConfigurationError('Unexpected runtime skill.');
  for (const name of APPLICATION_SKILLS) {
    const directory = join(/* turbopackIgnore: true */ root, name);
    if ((await exists(directory))?.isSymbolicLink()) throw new AgentConfigurationError('Runtime skills cannot be symbolic links.');
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory)) if (entry !== 'SKILL.md') throw new AgentConfigurationError('Unexpected runtime skill resource.');
    const target = join(/* turbopackIgnore: true */ directory, 'SKILL.md');
    if ((await exists(target))?.isSymbolicLink()) throw new AgentConfigurationError('Runtime skills cannot be symbolic links.');
    const content = await skillInstructions(name);
    try { await writeFile(target, content, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await readFile(target, 'utf8') !== content) throw new AgentConfigurationError('Runtime skill differs from the managed version. Use a new runtime directory.');
    }
  }
}
/** `user` means ONLY the application's explicit CLAUDE_CONFIG_DIR, never the developer's home.
 * Project/local sources are excluded, so ancestor repository instructions are not loaded. */
export const applicationSkillOptions = {
  settingSources: ['user'], skills: [...APPLICATION_SKILLS], plugins: [],
  settings: { syncClaudeAiSkills: false, syncClaudeAiPlugins: false }
} satisfies Options;
export function selectApplicationSkill(request: string): ApplicationSkill | null {
  if (/daily.*brief|morning.*(?:brief|summary)|portfolio briefing|daily-portfolio-briefing/i.test(request)) return 'daily-portfolio-briefing';
  if (/earnings|quarterly results|earnings-news-review/i.test(request)) return 'earnings-news-review';
  return null;
}
