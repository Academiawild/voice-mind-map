import { z } from 'zod/v4';

const CaptureRecordBaseSchema = z
  .object({
    id: z.string().uuid(),
    source: z.enum(['file', 'realtime']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const RecognizedCaptureRecordSchema = CaptureRecordBaseSchema.extend({
  status: z.literal('recognized'),
  transcript: z.string().trim().min(1),
  recordingDir: z.string().trim().min(1),
});
export const OrganizedCaptureRecordSchema = CaptureRecordBaseSchema.extend({
  status: z.literal('organized'),
  transcript: z.string().trim().min(1),
  recordingDir: z.string().trim().min(1),
});
export const FailedCaptureRecordSchema = CaptureRecordBaseSchema.extend({
  status: z.literal('failed'),
  error: z.string().trim().min(1),
});

export const CaptureRecordSchema = z.discriminatedUnion('status', [
  RecognizedCaptureRecordSchema,
  OrganizedCaptureRecordSchema,
  FailedCaptureRecordSchema,
]);

export const CaptureJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(CaptureRecordSchema),
  })
  .strict();

export const PendingCapturesResponseSchema = z
  .object({
    captures: z.array(RecognizedCaptureRecordSchema),
  })
  .strict();

export const TranscriptionResponseSchema = z
  .object({
    capture: RecognizedCaptureRecordSchema,
  })
  .strict();

export const CaptureOrganizedResponseSchema = z
  .object({
    capture: OrganizedCaptureRecordSchema,
  })
  .strict();

export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;
export type RecognizedCaptureRecord = z.infer<typeof RecognizedCaptureRecordSchema>;
export type CaptureJournal = z.infer<typeof CaptureJournalSchema>;
export type PendingCapturesResponse = z.infer<typeof PendingCapturesResponseSchema>;
export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;
export type CaptureOrganizedResponse = z.infer<typeof CaptureOrganizedResponseSchema>;
