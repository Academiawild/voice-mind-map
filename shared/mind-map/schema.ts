import { z } from 'zod/v4';

export const MIND_MAP_SCHEMA_VERSION = 2 as const;
export const MAX_MIND_MAP_NODES = 200;

export const MindMapNodeKindSchema = z.enum([
  'topic',
  'task',
  'idea',
  'note',
  'question',
  'risk',
  'resource',
  'decision',
]);
export const MindMapNodeStatusSchema = z.enum(['open', 'done', 'later']);
export const MindMapNodeSourceSchema = z.enum(['user', 'summary', 'inference']);
export const MindMapLayoutDirectionSchema = z.enum(['right', 'left', 'down', 'up']);
export const MindMapPlacementSideSchema = z.enum(['left', 'right', 'above', 'below']);

export const MindMapRelativePlacementSchema = z
  .object({
    relativeTo: z.string().trim().min(1),
    side: MindMapPlacementSideSchema,
    distance: z.number().finite().min(40).max(1200).optional(),
  })
  .strict();

export const MindMapRelationSchema = z
  .object({
    id: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    label: z.string().trim().max(80).optional(),
    dashed: z.boolean().optional(),
  })
  .strict();

export const MindMapGroupSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(80),
    memberIds: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const MindMapNodeSchema = z.strictObject({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  content: z.string(),
  kind: MindMapNodeKindSchema,
  status: MindMapNodeStatusSchema,
  source: MindMapNodeSourceSchema,
  layoutDirection: MindMapLayoutDirectionSchema.optional(),
  layoutOrder: z.number().finite().optional(),
  relativePlacement: MindMapRelativePlacementSchema.optional(),
  importance: z.number().finite().min(0).max(1).optional(),
  get children() {
    return z.array(MindMapNodeSchema);
  },
});

const MindMapContentObjectSchema = z
  .object({
    title: z.string().trim().min(1),
    root: MindMapNodeSchema,
    relations: z.array(MindMapRelationSchema).default([]),
    groups: z.array(MindMapGroupSchema).default([]),
  })
  .strict();

function collectNodes(root: MindMapNode) {
  const nodes: MindMapNode[] = [];
  const visit = (node: MindMapNode) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

function validateContentReferences(
  content: z.infer<typeof MindMapContentObjectSchema>,
  context: z.RefinementCtx<z.output<typeof MindMapContentObjectSchema>>,
) {
  const nodes = collectNodes(content.root);
  const nodeIds = nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);

  if (nodes.length > MAX_MIND_MAP_NODES) {
    context.addIssue({
      code: 'custom',
      path: ['root'],
      message: `Mind map cannot contain more than ${MAX_MIND_MAP_NODES} nodes.`,
    });
  }
  if (nodeIdSet.size !== nodeIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['root'],
      message: 'Mind map node ids must be unique.',
    });
  }

  for (const node of nodes) {
    if (
      node.relativePlacement &&
      (node.relativePlacement.relativeTo === node.id ||
        !nodeIdSet.has(node.relativePlacement.relativeTo))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['root'],
        message: `Node ${node.id} has an invalid relative placement.`,
      });
    }
  }

  const relationIds = new Set<string>();
  for (const relation of content.relations) {
    if (relationIds.has(relation.id)) {
      context.addIssue({
        code: 'custom',
        path: ['relations'],
        message: `Duplicate relation id: ${relation.id}.`,
      });
    }
    relationIds.add(relation.id);
    if (
      relation.sourceId === relation.targetId ||
      !nodeIdSet.has(relation.sourceId) ||
      !nodeIdSet.has(relation.targetId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relations'],
        message: `Relation ${relation.id} must connect two different existing nodes. Received ${relation.sourceId} -> ${relation.targetId}. ${relation.sourceId === relation.targetId ? 'Self-links are forbidden: remove this relation or connect two distinct nodes.' : ''} Available node IDs: ${nodeIds.join(', ')}.`,
      });
    }
  }

  const groupIds = new Set<string>();
  for (const group of content.groups) {
    if (groupIds.has(group.id)) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: `Duplicate group id: ${group.id}.`,
      });
    }
    groupIds.add(group.id);
    if (new Set(group.memberIds).size !== group.memberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: `Group ${group.id} contains duplicate members.`,
      });
    }
    if (group.memberIds.some((nodeId) => !nodeIdSet.has(nodeId))) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: `Group ${group.id} contains a missing node.`,
      });
    }
  }
}

export const MindMapContentSchema =
  MindMapContentObjectSchema.superRefine(validateContentReferences);

export const MindMapDocumentSchema = MindMapContentObjectSchema.extend({
  schemaVersion: z.literal(MIND_MAP_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
}).superRefine(validateContentReferences);

export const MindMapNodePatchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    content: z.string().optional(),
    kind: MindMapNodeKindSchema.optional(),
    status: MindMapNodeStatusSchema.optional(),
    source: MindMapNodeSourceSchema.optional(),
    layoutDirection: MindMapLayoutDirectionSchema.optional(),
    layoutOrder: z.number().finite().nullable().optional(),
    relativePlacement: MindMapRelativePlacementSchema.nullable().optional(),
    importance: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Node patch cannot be empty.');

export const ReplaceDocumentCommandSchema = z
  .object({
    type: z.literal('replaceDocument'),
    document: MindMapContentSchema,
  })
  .strict();
export const AddNodeCommandSchema = z
  .object({
    type: z.literal('addNode'),
    parentId: z.string().trim().min(1),
    node: MindMapNodeSchema,
  })
  .strict();
export const UpdateNodeCommandSchema = z
  .object({
    type: z.literal('updateNode'),
    nodeId: z.string().trim().min(1),
    patch: MindMapNodePatchSchema,
  })
  .strict();
export const MoveNodeCommandSchema = z
  .object({
    type: z.literal('moveNode'),
    nodeId: z.string().trim().min(1),
    newParentId: z.string().trim().min(1),
  })
  .strict();
export const DeleteNodeCommandSchema = z
  .object({
    type: z.literal('deleteNode'),
    nodeId: z.string().trim().min(1),
  })
  .strict();
export const UpsertRelationCommandSchema = z
  .object({
    type: z.literal('upsertRelation'),
    relation: MindMapRelationSchema,
  })
  .strict();
export const DeleteRelationCommandSchema = z
  .object({
    type: z.literal('deleteRelation'),
    relationId: z.string().trim().min(1),
  })
  .strict();
export const UpsertGroupCommandSchema = z
  .object({
    type: z.literal('upsertGroup'),
    group: MindMapGroupSchema,
  })
  .strict();
export const DeleteGroupCommandSchema = z
  .object({
    type: z.literal('deleteGroup'),
    groupId: z.string().trim().min(1),
  })
  .strict();

export const MindMapCommandSchema = z.discriminatedUnion('type', [
  ReplaceDocumentCommandSchema,
  AddNodeCommandSchema,
  UpdateNodeCommandSchema,
  MoveNodeCommandSchema,
  DeleteNodeCommandSchema,
  UpsertRelationCommandSchema,
  DeleteRelationCommandSchema,
  UpsertGroupCommandSchema,
  DeleteGroupCommandSchema,
]);

export const ThinkingEntrySchema = z
  .object({
    nodeId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(500),
    nextStep: z.string().trim().min(1).max(500),
  })
  .strict();

export type ThinkingEntry = z.infer<typeof ThinkingEntrySchema>;

export const MindMapChangeSetSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    summary: z.string().trim().min(1),
    commands: z.array(MindMapCommandSchema).max(100),
    navigation: z.array(ThinkingEntrySchema).max(3).optional(),
  })
  .strict();

export const MindMapRejectedCommandSchema = z
  .object({
    command: MindMapCommandSchema,
    code: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

export const MindMapIntentSchema = z.enum(['manual', 'batch', 'live']);
export const MindMapLayoutPreferencesSchema = z.record(
  z.string(),
  z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
);

export const MindMapChangeRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(100_000),
    intent: MindMapIntentSchema.default('manual'),
    document: MindMapDocumentSchema.nullable(),
    selectedNodeId: z.string().trim().min(1).nullable().default(null),
    layoutPreferences: MindMapLayoutPreferencesSchema.default({}),
    feedback: z.array(z.string().trim().min(1)).max(30).default([]),
    captureId: z.string().uuid().optional(),
  })
  .strict();

export const MindMapChangeResponseSchema = z
  .object({
    document: MindMapDocumentSchema,
    changeSet: MindMapChangeSetSchema,
    appliedCommands: z.array(MindMapCommandSchema),
    rejectedCommands: z.array(MindMapRejectedCommandSchema),
  })
  .strict();

export type MindMapNodeKind = z.infer<typeof MindMapNodeKindSchema>;
export type MindMapNodeStatus = z.infer<typeof MindMapNodeStatusSchema>;
export type MindMapNodeSource = z.infer<typeof MindMapNodeSourceSchema>;
export type MindMapLayoutDirection = z.infer<typeof MindMapLayoutDirectionSchema>;
export type MindMapPlacementSide = z.infer<typeof MindMapPlacementSideSchema>;
export type MindMapRelativePlacement = z.infer<typeof MindMapRelativePlacementSchema>;
export type MindMapRelation = z.infer<typeof MindMapRelationSchema>;
export type MindMapGroup = z.infer<typeof MindMapGroupSchema>;
export type MindMapNode = z.infer<typeof MindMapNodeSchema>;
export type MindMapContent = z.infer<typeof MindMapContentSchema>;
export type MindMapDocument = z.infer<typeof MindMapDocumentSchema>;
export type MindMapNodePatch = z.infer<typeof MindMapNodePatchSchema>;
export type MindMapCommand = z.infer<typeof MindMapCommandSchema>;
export type MindMapChangeSet = z.infer<typeof MindMapChangeSetSchema>;
export type MindMapRejectedCommand = z.infer<typeof MindMapRejectedCommandSchema>;
export type MindMapIntent = z.infer<typeof MindMapIntentSchema>;
export type MindMapLayoutPreferences = z.infer<typeof MindMapLayoutPreferencesSchema>;
export type MindMapChangeRequest = z.infer<typeof MindMapChangeRequestSchema>;
export type MindMapChangeResponse = z.infer<typeof MindMapChangeResponseSchema>;
