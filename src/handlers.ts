export type TextRewriteProfile = "plain_basic_paper" | "academic_plain" | "logic_smoothing";
export type TextRewriteMode = "policy_ready" | "guard" | "compare";
export type IssueSeverity = "error" | "warning";

export interface TextRewriteGuardPolicy {
  target_word_ratio_min: number;
  target_word_ratio_max: number;
  protected_terms: string[];
  preserve_numbers: boolean;
  preserve_citations: boolean;
  remove_subjective_phrases: boolean;
  keep_core_meaning: boolean;
}

export interface TextRewriteInstructionPackResult {
  mode: "policy_ready";
  profile: TextRewriteProfile;
  field: string;
  missing_inputs: string[];
  result: string;
  next_action: string;
}

export interface TextRewriteIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  evidence?: string[];
}

export interface TextRewriteMetrics {
  original_length: number;
  revised_length: number;
  length_ratio: number;
  original_sentence_count: number;
  revised_sentence_count: number;
  original_period_count: number;
  revised_period_count: number;
  original_comma_semicolon_count: number;
  revised_comma_semicolon_count: number;
  original_number_count: number;
  revised_number_count: number;
  original_citation_count: number;
  revised_citation_count: number;
}

export interface TextRewriteGuardResult {
  mode: "guard";
  passed: boolean;
  blocking_issue_count: number;
  issues: TextRewriteIssue[];
  metrics: TextRewriteMetrics;
  recommendations: string[];
  result: string;
  next_action: string;
}

export interface TextRewriteCompareResult {
  mode: "compare";
  metrics: TextRewriteMetrics;
  report: string[];
  result: string;
  next_action: string;
}

type Input = Record<string, unknown>;

const SUBJECTIVE_PHRASES = ["我觉得", "我认为", "个人认为", "本人认为", "笔者认为", "在我看来"];
const ORAL_PHRASES = ["真的", "特别", "超级", "很厉害", "挺", "搞", "东西", "就是说", "然后呢"];
const OVER_PROFESSIONAL_TERMS = ["赋能", "范式", "多维度", "系统性", "协同", "显著", "创新性", "机制", "耦合", "鲁棒"];

function stringInput(input: Input, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberInput(input: Input, key: string, fallback: number): number {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanInput(input: Input, key: string, fallback: boolean): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function arrayStringInput(input: Input, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function enumInput<T extends readonly string[]>(input: Input, key: string, allowed: T, fallback: T[number]): T[number] {
  const value = stringInput(input, key);
  return allowed.includes(value) ? (value as T[number]) : fallback;
}

function textLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function extractNumbers(text: string): string[] {
  return unique(text.match(/\d+(?:\.\d+)?%?|\d{4}年/g) || []);
}

function extractCitations(text: string): string[] {
  return unique(text.match(/\[[^\]]+\]|［[^］]+］|\([A-Z][A-Za-z]+(?:\s+et\sal\.)?,?\s*\d{4}[a-z]?\)/g) || []);
}

function countMatches(text: string, regex: RegExp): number {
  return (text.match(regex) || []).length;
}

function buildPolicy(input: Input): TextRewriteGuardPolicy {
  const min = numberInput(input, "target_word_ratio_min", 0.85);
  const max = numberInput(input, "target_word_ratio_max", 1.15);
  return {
    target_word_ratio_min: Math.min(min, max),
    target_word_ratio_max: Math.max(min, max),
    protected_terms: arrayStringInput(input, "protected_terms"),
    preserve_numbers: booleanInput(input, "preserve_numbers", true),
    preserve_citations: booleanInput(input, "preserve_citations", true),
    remove_subjective_phrases: booleanInput(input, "remove_subjective_phrases", true),
    keep_core_meaning: booleanInput(input, "keep_core_meaning", true)
  };
}

function buildMetrics(originalText: string, revisedText: string): TextRewriteMetrics {
  const originalLength = textLength(originalText);
  const revisedLength = textLength(revisedText);
  return {
    original_length: originalLength,
    revised_length: revisedLength,
    length_ratio: originalLength === 0 ? 0 : Number((revisedLength / originalLength).toFixed(3)),
    original_sentence_count: countMatches(originalText, /[。.!！？?]/g),
    revised_sentence_count: countMatches(revisedText, /[。.!！？?]/g),
    original_period_count: countMatches(originalText, /[。\.]/g),
    revised_period_count: countMatches(revisedText, /[。\.]/g),
    original_comma_semicolon_count: countMatches(originalText, /[，,；;]/g),
    revised_comma_semicolon_count: countMatches(revisedText, /[，,；;]/g),
    original_number_count: extractNumbers(originalText).length,
    revised_number_count: extractNumbers(revisedText).length,
    original_citation_count: extractCitations(originalText).length,
    revised_citation_count: extractCitations(revisedText).length
  };
}

function bullet(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function missingInputsForText(input: Input, keys: string[]): string[] {
  return keys.filter((key) => !stringInput(input, key)).map((key) => `${key} is required.`);
}

function buildInstructionPack(policy: TextRewriteGuardPolicy): string[] {
  return [
    "在不大幅改变原文总字数的情况下改写，默认把改写后长度控制在原文的 85% 到 115% 之间；如果用户指定范围，以用户范围为准。",
    "优先调整语序、替换同义表达、变换主谓宾结构，并为缺少主语的句子补出清楚主语。",
    "保持基础论文写作规范：语句要有逻辑、能读通，但不要把文字改得过度高级或过度精炼。",
    "弱化过强专业感和模板腔，把过于抽象、华丽、复杂的词换成更普通、更平实的表达。",
    "删除“我觉得、我认为、个人认为”等主观口吻，不保留明显口水话，同时保持基本书面表达。",
    "可以用逗号、分号衔接相关短句，但不要为了减少句号而制造病句；长句应先拆清楚，再自然连接。",
    "打乱原句结构时，不改变原文核心意思，不删事实、不改数字、不丢引用、不替换受保护术语。",
    "输出时必须给出改写文本、主要改动说明、保留项检查、可能风险。",
    policy.protected_terms.length > 0
      ? `以下术语必须原样保留或经用户确认后再改：${policy.protected_terms.join("、")}`
      : "如用户给出专业术语、人名、方法名、数据集名、变量名，应默认视为受保护术语。"
  ];
}

export function buildTextRewriteInstructionPack(input: Input): TextRewriteInstructionPackResult {
  const profile = enumInput(input, "profile", ["plain_basic_paper", "academic_plain", "logic_smoothing"] as const, "plain_basic_paper");
  const field = stringInput(input, "field") || "general";
  const missingInputs = missingInputsForText(input, ["original_text"]);
  const result = missingInputs.length > 0
    ? "TextRewrite policy is available. Original text is still required before rewriting."
    : "TextRewrite policy ready.";

  return {
    mode: "policy_ready",
    profile,
    field,
    missing_inputs: missingInputs,
    result,
    next_action: missingInputs.length > 0
      ? "Ask the user or client model for original_text before rewriting."
      : "Proceed with rewriting according to the configured policy, then call textrewrite_guard on the original and revised text."
  };
}

function missingFromRevised(items: string[], revisedText: string): string[] {
  return items.filter((item) => item && !revisedText.includes(item));
}

function findPhrases(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

export function buildTextRewriteGuard(input: Input): TextRewriteGuardResult {
  const originalText = stringInput(input, "original_text");
  const revisedText = stringInput(input, "revised_text");
  const policy = buildPolicy(input);
  const metrics = buildMetrics(originalText, revisedText);
  const issues: TextRewriteIssue[] = [];

  if (!originalText) {
    issues.push({ severity: "error", code: "missing_original_text", message: "original_text is required for guard checks." });
  }
  if (!revisedText) {
    issues.push({ severity: "error", code: "missing_revised_text", message: "revised_text is required for guard checks." });
  }

  if (originalText && revisedText) {
    if (metrics.length_ratio < policy.target_word_ratio_min || metrics.length_ratio > policy.target_word_ratio_max) {
      issues.push({
        severity: "error",
        code: "length_ratio_out_of_range",
        message: `Revised/original length ratio ${metrics.length_ratio} is outside target range ${policy.target_word_ratio_min}-${policy.target_word_ratio_max}.`
      });
    }

    if (policy.preserve_numbers) {
      const missingNumbers = missingFromRevised(extractNumbers(originalText), revisedText);
      for (const number of missingNumbers) {
        issues.push({ severity: "error", code: "missing_number", message: `Number or numeric marker is missing from revised text: ${number}`, evidence: [number] });
      }
    }

    if (policy.preserve_citations) {
      const missingCitations = missingFromRevised(extractCitations(originalText), revisedText);
      for (const citation of missingCitations) {
        issues.push({ severity: "error", code: "missing_citation", message: `Citation marker is missing from revised text: ${citation}`, evidence: [citation] });
      }
    }

    const missingProtectedTerms = missingFromRevised(policy.protected_terms.filter((term) => originalText.includes(term)), revisedText);
    for (const term of missingProtectedTerms) {
      issues.push({ severity: "error", code: "missing_protected_term", message: `Protected term is missing from revised text: ${term}`, evidence: [term] });
    }

    if (policy.remove_subjective_phrases) {
      for (const phrase of findPhrases(revisedText, SUBJECTIVE_PHRASES)) {
        issues.push({ severity: "error", code: "subjective_phrase", message: `Subjective phrase should be removed: ${phrase}`, evidence: [phrase] });
      }
    }

    const oralPhrases = findPhrases(revisedText, ORAL_PHRASES);
    if (oralPhrases.length > 0) {
      issues.push({ severity: "warning", code: "oral_expression", message: "Revised text still contains overly casual expressions.", evidence: oralPhrases });
    }

    const addedProfessionalTerms = OVER_PROFESSIONAL_TERMS.filter((term) => revisedText.includes(term) && !originalText.includes(term));
    if (addedProfessionalTerms.length > 0) {
      issues.push({ severity: "warning", code: "over_professionalized", message: "Revised text adds professional or template-like terms that may conflict with plain_basic_paper style.", evidence: addedProfessionalTerms });
    }
  }

  const blockingIssueCount = issues.filter((issue) => issue.severity === "error").length;
  const recommendations = buildGuardRecommendations(issues, metrics);
  const passed = blockingIssueCount === 0;
  const result = [
    `TextRewrite guard: ${passed ? "PASS" : "NEEDS_REVISION"}`,
    `Blocking issues: ${blockingIssueCount}`,
    `Length ratio: ${metrics.length_ratio}`,
    issues.length > 0 ? "Issues:\n" + bullet(issues.map((issue) => `${issue.severity}:${issue.code} - ${issue.message}`)) : "Issues: none",
    "Recommendations:",
    bullet(recommendations)
  ].join("\n");

  return {
    mode: "guard",
    passed,
    blocking_issue_count: blockingIssueCount,
    issues,
    metrics,
    recommendations,
    result,
    next_action: passed ? "Use the revised text, or run textrewrite_compare for a compact change report." : "Revise the rewritten text using the reported blocking issues, then run textrewrite_guard again."
  };
}

function buildGuardRecommendations(issues: TextRewriteIssue[], metrics: TextRewriteMetrics): string[] {
  const recommendations: string[] = [];
  if (issues.some((issue) => issue.code === "length_ratio_out_of_range")) {
    recommendations.push("Bring the rewritten text closer to the original length before delivery.");
  }
  if (issues.some((issue) => issue.code === "missing_number" || issue.code === "missing_citation" || issue.code === "missing_protected_term")) {
    recommendations.push("Restore missing numbers, citations, and protected terms exactly unless the user explicitly approves changes.");
  }
  if (issues.some((issue) => issue.code === "subjective_phrase")) {
    recommendations.push("Remove first-person subjective phrases and rewrite them as objective basic-paper statements.");
  }
  if (metrics.revised_period_count > metrics.original_period_count + 3) {
    recommendations.push("Re-check punctuation: do not fragment the text into too many period-ended sentences.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No blocking guard issues were found; still manually check core meaning before final use.");
  }
  return recommendations;
}

export function buildTextRewriteCompare(input: Input): TextRewriteCompareResult {
  const originalText = stringInput(input, "original_text");
  const revisedText = stringInput(input, "revised_text");
  const metrics = buildMetrics(originalText, revisedText);
  const originalNumbers = extractNumbers(originalText);
  const revisedNumbers = extractNumbers(revisedText);
  const originalCitations = extractCitations(originalText);
  const revisedCitations = extractCitations(revisedText);
  const numberPreservation = originalNumbers.filter((item) => revisedNumbers.includes(item)).length;
  const citationPreservation = originalCitations.filter((item) => revisedCitations.includes(item)).length;
  const report = [
    `字数/长度：原文 ${metrics.original_length}，改写 ${metrics.revised_length}，比例 ${metrics.length_ratio}。`,
    `标点：原文句号 ${metrics.original_period_count}、逗号/分号 ${metrics.original_comma_semicolon_count}；改写句号 ${metrics.revised_period_count}、逗号/分号 ${metrics.revised_comma_semicolon_count}。`,
    `数字保留：${numberPreservation}/${originalNumbers.length}。`,
    `引用保留：${citationPreservation}/${originalCitations.length}。`,
    "人工复核重点：核心意思、事实边界、术语、因果关系是否保持一致。"
  ];
  const result = ["TextRewrite compare report", "", ...report.map((item) => `- ${item}`)].join("\n");

  return {
    mode: "compare",
    metrics,
    report,
    result,
    next_action: "If comparison shows missing facts or large length drift, revise and then run textrewrite_guard."
  };
}
