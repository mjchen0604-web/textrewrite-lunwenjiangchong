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
  return {
    content: [
      {
        type: "text",
        text: `${structuredContent.next_action}\n\n${structuredContent.result}\n\n${JSON.stringify(structuredContent, null, 2)}`
      }
    ],
    structuredContent: structuredContent as unknown as Record<string, unknown>
  };
}

const profileSchema = z.enum(["plain_basic_paper", "academic_plain", "logic_smoothing"]).optional().describe("Rewrite profile. Use plain_basic_paper for ordinary basic thesis prose.");
const protectedTermsSchema = z.array(z.string()).optional().describe("Terms, names, numbers, methods, variables, citations, or fixed phrases that should not be changed.");
const ratioMinSchema = z.number().optional().describe("Minimum revised/original length ratio. Default 0.85.");
const ratioMaxSchema = z.number().optional().describe("Maximum revised/original length ratio. Default 1.15.");

const commonRewriteSchema = {
  original_text: z.string().optional().describe("Original user-owned draft text to rewrite or guard."),
  revised_text: z.string().optional().describe("Rewritten text to check or compare against original_text."),
  profile: profileSchema,
  field: z.string().optional().describe("Subject area, if relevant."),
  protected_terms: protectedTermsSchema,
  target_word_ratio_min: ratioMinSchema,
  target_word_ratio_max: ratioMaxSchema,
  preserve_numbers: z.boolean().optional().describe("Whether numeric markers must be preserved. Default true."),
  preserve_citations: z.boolean().optional().describe("Whether citation markers must be preserved. Default true."),
  remove_subjective_phrases: z.boolean().optional().describe("Whether first-person subjective phrases should be flagged. Default true.")
};

export function registerTextRewriteTools(server: McpServer): void {
  server.registerTool(
    "textrewrite_instruction_pack",
    {
      title: "TextRewrite instruction pack",
      description: "Return a structured instruction pack for basic academic text rewriting: plain wording, reordered syntax, synonym replacement, subject completion, and preservation rules. This is not a hidden LLM call.",
      inputSchema: {
        original_text: commonRewriteSchema.original_text,
        profile: commonRewriteSchema.profile,
        field: commonRewriteSchema.field,
        protected_terms: commonRewriteSchema.protected_terms,
        target_word_ratio_min: commonRewriteSchema.target_word_ratio_min,
        target_word_ratio_max: commonRewriteSchema.target_word_ratio_max,
        preserve_numbers: commonRewriteSchema.preserve_numbers,
        preserve_citations: commonRewriteSchema.preserve_citations,
        remove_subjective_phrases: commonRewriteSchema.remove_subjective_phrases
      }
    },
    async (args) => textRewriteResult(args, buildTextRewriteInstructionPack)
  );

  server.registerTool(
    "textrewrite_guard",
    {
      title: "TextRewrite guard",
      description: "Check a rewritten text against the original for length drift, missing numbers, missing citations, missing protected terms, subjective phrases, and style-policy risks.",
      inputSchema: commonRewriteSchema
    },
    async (args) => textRewriteResult(args, buildTextRewriteGuard)
  );

  server.registerTool(
    "textrewrite_compare",
    {
      title: "TextRewrite compare",
      description: "Return a compact comparison report for original and rewritten text: length ratio, punctuation changes, number/citation preservation, and manual review focus.",
      inputSchema: {
        original_text: commonRewriteSchema.original_text,
        revised_text: commonRewriteSchema.revised_text
      }
    },
    async (args) => textRewriteResult(args, buildTextRewriteCompare)
  );
}
