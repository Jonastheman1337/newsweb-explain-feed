import { z } from "zod";

export const newswebCategorySchema = z.object({
  category_no: z.string(),
  category_en: z.string()
});

export const newswebListMessageSchema = z.object({
  messageId: z.number().int(),
  newsId: z.number().int(),
  title: z.string(),
  issuerName: z.string(),
  issuerSign: z.string(),
  publishedTime: z.string().datetime(),
  markets: z.array(z.string()),
  category: z.array(newswebCategorySchema),
  numbAttachments: z.number().int().nonnegative()
});

export const newswebListResponseSchema = z.object({
  data: z.object({
    messages: z.array(newswebListMessageSchema),
    overflow: z.boolean()
  })
});

export const newswebMessageAttachmentSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  fileType: z.string().nullable().optional(),
  fileSize: z.number().nullable().optional()
});

export const newswebMessageSchema = z.object({
  messageId: z.number().int(),
  title: z.string(),
  issuerName: z.string().nullable().optional(),
  issuerSign: z.string().nullable().optional(),
  publishedTime: z.string().datetime().nullable().optional(),
  body: z.string().default(""),
  attachments: z.array(newswebMessageAttachmentSchema).default([])
});

export const newswebMessageResponseSchema = z.object({
  data: z.object({
    message: newswebMessageSchema,
    textFormat: z.string().optional()
  })
});

export const newswebMetaCategoriesSchema = z.object({
  data: z.object({
    categories: z.array(
      z.object({
        id: z.number().int(),
        category_no: z.string(),
        category_en: z.string()
      })
    )
  })
});

export const newswebMetaMarketsSchema = z.object({
  data: z.object({
    markets: z.array(
      z.object({
        id: z.number().int(),
        symbol: z.string(),
        name: z.string()
      })
    )
  })
});

export const newswebMetaIssuersSchema = z.object({
  data: z.object({
    issuers: z.array(
      z.object({
        issuerId: z.number().int().nullable().optional(),
        symbol: z.string().nullable().optional(),
        issuerSign: z.string().optional(),
        name: z.string().nullable().optional(),
        isActive: z.number().int().optional()
      })
    )
  })
});
