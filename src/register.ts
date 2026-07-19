import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  buildTextRewriteCompare,
  buildTextRewriteGuard,
  buildTextRewriteInstructionPack
} from "./handlers.js";

type TextRewriteBuilder = (args: Record<string, unknown>) => {
  result: string;
  next_action: string;
};

function textRewriteResult(args: Record<string, unknown>, builder: TextRewriteBuilder): CallToolResult {
  const structuredContent = builder(args);
  const text = [structuredContent.next_action, structuredContent.result].filter(Boolean).join("\n\n");
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent: structuredContent as unknown as Record<string, unknown>
  };
}


const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const profileSchema = z.enum(["plain_basic_paper", "academic_plain", "logic_smoothing"]).optional().describe("Rewrite profile. Use plain_basic_paper for ordinary basic thesis prose.");
const protectedTermsSchema = z.array(z.string().min(1)).optional().describe("Terms, names, numbers, methods, variables, citations, or fixed phrases that must be preserved unless the user approves changes.");
const ratioMinSchema = z.number().min(0.1).max(2).optional().describe("Minimum revised/original length ratio. Default is 0.85.");
const ratioMaxSchema = z.number().min(0.1).max(2).optional().describe("Maximum revised/original length ratio. Default is 1.15.");

const optionalPolicyInputSchema = {
  profile: profileSchema,
  field: z.string().optional().describe("Subject area or writing context, if relevant."),
  protected_terms: protectedTermsSchema,
  target_word_ratio_min: ratioMinSchema,
  target_word_ratio_max: ratioMaxSchema,
  preserve_numbers: z.boolean().optional().describe("Whether numeric markers must be preserved. Default true."),
  preserve_citations: z.boolean().optional().describe("Whether citation markers must be preserved. Default true."),
  remove_subjective_phrases: z.boolean().optional().describe("Whether first-person subjective phrases should be flagged. Default true.")
};

const instructionPackInputSchema = {
  original_text: z.string().min(1).describe("Original user-owned draft text to rewrite; summarize only if too long for the client context."),
  ...optionalPolicyInputSchema
};

const guardInputSchema = {
  original_text: z.string().min(1).describe("Original user-owned draft text used as the factual and structural baseline."),
  revised_text: z.string().min(1).describe("Rewritten text to check against original_text."),
  ...optionalPolicyInputSchema
};

const compareInputSchema = {
  original_text: z.string().min(1).describe("Original user-owned draft text used as the comparison baseline."),
  revised_text: z.string().min(1).describe("Rewritten text to compare against original_text.")
};

const issueSchema = z.object({
  severity: z.enum(["error", "warning"]).describe("Issue severity."),
  code: z.string().describe("Stable issue code."),
  message: z.string().describe("Human-readable issue message."),
  evidence: z.array(z.string()).optional().describe("Optional evidence snippets or items related to the issue.")
});

const metricsSchema = z.object({
  original_length: z.number().describe("Character-like length of the original text after whitespace normalization."),
  revised_length: z.number().describe("Character-like length of the revised text after whitespace normalization."),
  length_ratio: z.number().describe("Revised/original length ratio rounded to three decimals."),
  original_sentence_count: z.number().describe("Sentence-ending marker count in the original text."),
  revised_sentence_count: z.number().describe("Sentence-ending marker count in the revised text."),
  original_period_count: z.number().describe("Period/full-stop count in the original text."),
  revised_period_count: z.number().describe("Period/full-stop count in the revised text."),
  original_comma_semicolon_count: z.number().describe("Comma and semicolon count in the original text."),
  revised_comma_semicolon_count: z.number().describe("Comma and semicolon count in the revised text."),
  original_number_count: z.number().describe("Distinct numeric marker count in the original text."),
  revised_number_count: z.number().describe("Distinct numeric marker count in the revised text."),
  original_citation_count: z.number().describe("Distinct citation marker count in the original text."),
  revised_citation_count: z.number().describe("Distinct citation marker count in the revised text.")
});

const commonTextFields = {
  result: z.string().describe("Markdown summary intended for the model/user."),
  next_action: z.string().describe("Recommended next action after this tool result.")
};

const instructionPackOutputSchema = {
  mode: z.literal("policy_ready"),
  profile: z.enum(["plain_basic_paper", "academic_plain", "logic_smoothing"]).describe("Normalized rewrite profile."),
  field: z.string().describe("Normalized subject area or general."),
  missing_inputs: z.array(z.string()).describe("Required inputs still missing."),
  ...commonTextFields
};

const guardOutputSchema = {
  mode: z.literal("guard"),
  passed: z.boolean().describe("True when no blocking error-level issues were found."),
  blocking_issue_count: z.number().describe("Number of error-level issues."),
  issues: z.array(issueSchema).describe("Detected guard issues."),
  metrics: metricsSchema,
  recommendations: z.array(z.string()).describe("Recommended revision actions."),
  ...commonTextFields
};

const compareOutputSchema = {
  mode: z.literal("compare"),
  metrics: metricsSchema,
  report: z.array(z.string()).describe("Compact comparison report lines."),
  ...commonTextFields
};

export function registerTextRewriteTools(server: McpServer): void {
  server.registerTool(
    "textrewrite_instruction_pack",
    {
      title: "TextRewrite instruction pack",
      description: "Use this when you need structured instructions for rewriting user-owned academic draft text with plain wording, syntax reordering, synonym replacement, subject completion, and preservation rules.",
      inputSchema: instructionPackInputSchema,
      outputSchema: instructionPackOutputSchema,
      annotations: toolAnnotations
    },
    async (args) => textRewriteResult(args, buildTextRewriteInstructionPack)
  );

  server.registerTool(
    "textrewrite_guard",
    {
      title: "TextRewrite guard",
      description: "Use this when you need to check rewritten text against the original for length drift, missing numbers, missing citations, missing protected terms, subjective phrases, and style-policy risks.",
      inputSchema: guardInputSchema,
      outputSchema: guardOutputSchema,
      annotations: toolAnnotations
    },
    async (args) => textRewriteResult(args, buildTextRewriteGuard)
  );

  server.registerTool(
    "textrewrite_compare",
    {
      title: "TextRewrite compare",
      description: "Use this when you need a compact comparison report for original and rewritten text covering length ratio, punctuation changes, number preservation, citation preservation, and manual review focus.",
      inputSchema: compareInputSchema,
      outputSchema: compareOutputSchema,
      annotations: toolAnnotations
    },
    async (args) => textRewriteResult(args, buildTextRewriteCompare)
  );
}
