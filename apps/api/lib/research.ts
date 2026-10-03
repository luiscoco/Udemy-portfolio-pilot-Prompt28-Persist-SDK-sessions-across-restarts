import { analyzeArticle, ARTICLE_ANALYSIS_PROMPT_VERSION, ClaudeArticleAnalyzer, MockArticleAnalyzer, type ArticleAnalyzer } from '@portfolio-pilot/agent';
import { ARTICLE_ANALYSIS_SCHEMA_VERSION } from '@portfolio-pilot/contracts';
import type { AnalyzerBinding } from '@portfolio-pilot/db';
import { parseServerConfig } from '@portfolio-pilot/config/server';

/** Binds an analyzer to the versions that, with the article revision, form the SHARED cache key. */
export function analyzerBinding(analyzer: ArticleAnalyzer): AnalyzerBinding {
  return { mode: analyzer.mode, modelKey: analyzer.modelKey, promptVersion: ARTICLE_ANALYSIS_PROMPT_VERSION, schemaVersion: ARTICLE_ANALYSIS_SCHEMA_VERSION,
    run: (input, signal) => analyzeArticle(analyzer, input, signal) };
}

// One binding per API process, so in-process single-flight and the model configuration are shared.
let binding: AnalyzerBinding | undefined;
/** The configured analyzer: deterministic mock without credentials, or one tool-less live Claude query. */
export function defaultAnalyzerBinding(): AnalyzerBinding {
  if (binding) return binding;
  const config = parseServerConfig(process.env);
  const analyzer = config.AGENT_MODE === 'mock' ? new MockArticleAnalyzer()
    : new ClaudeArticleAnalyzer({ apiKey: config.ANTHROPIC_API_KEY, modelId: config.AGENT_MODEL_ID!, workspaceDir: config.AGENT_WORKSPACE_DIR! });
  binding = analyzerBinding(analyzer);
  return binding;
}
