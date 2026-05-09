import { z } from "zod";

export interface Article {
  id: string;
  source: string;
  url: string;
  title: string;
  body: string;
  publishedAt: Date;
  topicScore: number;
  relatedImageUrls?: string[];
  relatedVideoUrls?: string[];
  entityXHandles?: string[];
}

export const HookSlideSchema = z.object({
  headline: z.string().min(1).max(80),
  highlight_phrases: z.array(z.string()).min(1).max(4),
  subject_photo_query: z.string().min(1),
  overlay_concept: z.string().min(1),
  sub_tagline: z.string().min(1).max(50),
  ticker_phrases: z.array(z.string().min(1).max(60)).default([]),
  entity_domains: z.array(z.string().min(1)).min(0).max(3).default([]),
  background_scene: z.string().min(1).max(180).default(""),
});

export const LayoutVariant = z.enum([
  "text_explainer",
  "stat_card",
  "quote_pull",
  "list_card",
]);

export const BodySlideSchema = z.object({
  slide_number: z.number().int().min(2),
  headline: z.string().min(1).max(100),
  highlight_phrases: z.array(z.string()).max(3),
  body_text: z.string().max(280).nullable().optional().transform((v) => v ?? ""),
  supporting_visual_concept: z.string().nullable().optional().transform((v) => v ?? ""),
  layout_variant: LayoutVariant.default("text_explainer"),
  product_screenshot_query: z.string().nullable().optional().transform((v) => v ?? undefined),
  stat_value: z.string().max(40).nullable().optional().transform((v) => v ?? undefined),
  stat_caption: z.string().max(80).nullable().optional().transform((v) => v ?? undefined),
  pull_quote: z.string().max(200).nullable().optional().transform((v) => v ?? undefined),
  quote_attribution: z.string().max(80).nullable().optional().transform((v) => v ?? undefined),
  list_items: z.array(z.string().min(1).max(120)).max(6).nullable().optional().transform((v) => v ?? undefined),
  list_title: z.string().max(80).nullable().optional().transform((v) => v ?? undefined),
  body_emphasis_phrases: z.array(z.string().min(1).max(120)).max(5).nullable().optional().transform((v) => v ?? []),
});

export const CtaSlideSchema = z.object({
  headline: z.string().min(1).max(100),
  highlight_phrases: z.array(z.string()).max(3),
});

export const TopicCategory = z.enum([
  "model_release",
  "research",
  "controversy",
  "tool",
  "business",
]);

export const SlideSpecSchema = z.object({
  carousel_id: z.string(),
  source_url: z.string().url(),
  topic_category: TopicCategory,
  hook_slide: HookSlideSchema,
  body_slides: z.array(BodySlideSchema).min(1).max(8),
  cta_slide: CtaSlideSchema,
  instagram_caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string()).min(3).max(30),
  related_image_urls: z.array(z.string().url()).default([]),
  related_video_urls: z.array(z.string().url()).default([]),
  entity_x_handles: z.array(z.string()).default([]),
  carousel_format: z.string().optional(),
});

export type SlideSpec = z.infer<typeof SlideSpecSchema>;
export type HookSlide = z.infer<typeof HookSlideSchema>;
export type BodySlide = z.infer<typeof BodySlideSchema>;
export type CtaSlide = z.infer<typeof CtaSlideSchema>;
