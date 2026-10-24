import { z } from 'zod/v4';
import { MindMapDocumentSchema, ThinkingEntrySchema } from '../../../shared/mind-map';
import type { WorkspacePersistence } from './model';

export const WORKSPACE_STORAGE_KEY = 'voice-mind-map:workspace:v2';

const PersistedWorkspaceSchema = z.object({
  document: MindMapDocumentSchema.nullable(),
  positions: z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() })),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }).nullable(),
  expandedInferenceNodeIds: z.array(z.string().min(1)),
  navigation: z.array(ThinkingEntrySchema).max(3).default([]),
  savedInputs: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        createdAt: z.string(),
        captureId: z.string().optional(),
      }),
    )
    .default([]),
  draft: z.string().default(''),
  acknowledgedCaptureIds: z.array(z.string()).default([]),
});

export function loadWorkspaceSnapshot(): WorkspacePersistence | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return undefined;
    const result = PersistedWorkspaceSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveWorkspaceSnapshot(snapshot: WorkspacePersistence) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify(PersistedWorkspaceSchema.parse(snapshot)),
    );
    return true;
  } catch {
    return false;
  }
}
