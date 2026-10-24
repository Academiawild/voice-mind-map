import { z } from 'zod/v4';

export const RuntimeStatusSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal('voice-mind-map'),
    runtimeId: z.string().min(1),
    shutdownToken: z.string(),
    ai: z
      .object({
        ready: z.boolean(),
        provider: z.literal('ollama'),
        model: z.string().min(1),
      })
      .strict(),
    transcription: z
      .object({
        http: z.object({ ready: z.boolean(), model: z.string() }).strict(),
        realtime: z.object({ ready: z.boolean(), model: z.string() }).strict(),
      })
      .strict(),
  })
  .strict();

export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
