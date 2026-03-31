import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';

interface FilterRuleConfig {
  keywords?: string[];
  boost?: number;
  minLength?: number;
  maxLength?: number;
  languages?: string[];
  authors?: string[];
  minAiScore?: number;
  maxAiScore?: number;
  minScore?: number;
}

interface FilterResult {
  passed: boolean;
  reason?: string;
  scoreAdjust: number;
}

export async function applyFilterRules(
  item: { title: string; content?: string | null; snippet?: string | null; author?: string | null; language?: string | null; sourceId: number; aiScore?: number | null },
  userId: string,
  options: { includeAiScoreRules?: boolean } = {},
): Promise<FilterResult> {
  const globalRules = await db
    .select()
    .from(schema.filterRules)
    .where(and(eq(schema.filterRules.scope, 'global'), eq(schema.filterRules.enabled, true)));
  const userRules = await db
    .select()
    .from(schema.filterRules)
    .where(and(eq(schema.filterRules.userId, userId), eq(schema.filterRules.enabled, true)));

  const rules = [...globalRules, ...userRules].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'global' ? -1 : 1;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });

  let scoreAdjust = 0;
  const text = `${item.title} ${item.snippet || ''} ${item.content || ''}`.toLowerCase();

  for (const rule of rules) {
    const config = rule.config as FilterRuleConfig;

    switch (rule.type) {
      case 'keyword_blacklist': {
        const keywords = config.keywords || [];
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            return { passed: false, reason: `blacklist: "${kw}"`, scoreAdjust: 0 };
          }
        }
        break;
      }

      case 'keyword_whitelist': {
        const keywords = config.keywords || [];
        const boost = config.boost || 10;
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            scoreAdjust += boost;
          }
        }
        break;
      }

      case 'length_filter': {
        const minLen = config.minLength || 0;
        const maxLen = config.maxLength || Infinity;
        const contentLen = (item.content || item.snippet || '').length;
        if (contentLen < minLen) {
          return { passed: false, reason: `too short: ${contentLen} < ${minLen}`, scoreAdjust: 0 };
        }
        if (contentLen > maxLen) {
          return { passed: false, reason: `too long: ${contentLen} > ${maxLen}`, scoreAdjust: 0 };
        }
        break;
      }

      case 'language_filter': {
        const langs = config.languages || [];
        if (langs.length > 0 && item.language && !langs.includes(item.language)) {
          return { passed: false, reason: `language: ${item.language} not in [${langs.join(',')}]`, scoreAdjust: 0 };
        }
        break;
      }

      case 'author_filter': {
        const authors = config.authors || [];
        if (authors.length > 0 && item.author) {
          const authorLower = item.author.toLowerCase();
          if (authors.some(a => authorLower.includes(a.toLowerCase()))) {
            return { passed: false, reason: `author blocked: ${item.author}`, scoreAdjust: 0 };
          }
        }
        break;
      }

      case 'ai_score_filter': {
        if (!options.includeAiScoreRules) break;
        const score = item.aiScore ?? 0;
        const minScore = config.minAiScore ?? 0;
        const maxScore = config.maxAiScore ?? 100;
        const boost = config.boost ?? 0;

        if (score < minScore) {
          return { passed: false, reason: `ai score too low: ${score} < ${minScore}`, scoreAdjust: 0 };
        }
        if (score > maxScore) {
          return { passed: false, reason: `ai score too high: ${score} > ${maxScore}`, scoreAdjust: 0 };
        }
        scoreAdjust += boost;
        break;
      }

      case 'source_priority': {
        if (!options.includeAiScoreRules) break;
        const score = item.aiScore ?? 0;
        const minScore = config.minScore ?? config.minAiScore ?? 0;
        if (score >= minScore) {
          scoreAdjust += config.boost ?? 20;
        }
        break;
      }
    }
  }

  return { passed: true, scoreAdjust };
}
