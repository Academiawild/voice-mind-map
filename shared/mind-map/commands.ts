import {
  MAX_MIND_MAP_NODES,
  MindMapDocumentSchema,
  type MindMapChangeSet,
  type MindMapCommand,
  type MindMapDocument,
  type MindMapNode,
  type MindMapNodePatch,
  type MindMapRejectedCommand,
} from './schema';
import { collectSubtreeIds, countMindMapNodes, findMindMapNodeById } from './selectors';

export type ApplyChangeSetOptions = {
  allowReplace: boolean;
};

export type ApplyChangeSetResult = {
  document: MindMapDocument | null;
  appliedCommands: MindMapCommand[];
  rejectedCommands: MindMapRejectedCommand[];
  revisionConflict: boolean;
};

function reject(command: MindMapCommand, code: string, reason: string): MindMapRejectedCommand {
  return { command, code, reason };
}

function updateTree(
  node: MindMapNode,
  nodeId: string,
  updater: (node: MindMapNode) => MindMapNode,
): MindMapNode {
  if (node.id === nodeId) {
    return updater(node);
  }
  return {
    ...node,
    children: node.children.map((child) => updateTree(child, nodeId, updater)),
  };
}

function addChild(node: MindMapNode, parentId: string, child: MindMapNode): MindMapNode {
  if (node.id === parentId) {
    return { ...node, children: [...node.children, child] };
  }
  return {
    ...node,
    children: node.children.map((candidate) => addChild(candidate, parentId, child)),
  };
}

function removeNode(
  node: MindMapNode,
  nodeId: string,
): { node: MindMapNode; removed: MindMapNode | null } {
  let removed: MindMapNode | null = null;
  const children: MindMapNode[] = [];
  for (const child of node.children) {
    if (child.id === nodeId) {
      removed = child;
      continue;
    }
    const nested = removeNode(child, nodeId);
    if (!removed && nested.removed) {
      removed = nested.removed;
    }
    children.push(nested.node);
  }
  return { node: { ...node, children }, removed };
}

function nodeContains(node: MindMapNode, candidateId: string): boolean {
  return node.children.some(
    (child) => child.id === candidateId || nodeContains(child, candidateId),
  );
}

function applyPatch(node: MindMapNode, patch: MindMapNodePatch): MindMapNode {
  const next = { ...node, ...patch } as MindMapNode;
  if (patch.layoutOrder === null) {
    delete next.layoutOrder;
  }
  if (patch.relativePlacement === null) {
    delete next.relativePlacement;
  }
  if (patch.importance === null) {
    delete next.importance;
  }
  return next;
}

function removeDeletedReferences(node: MindMapNode, deletedIds: ReadonlySet<string>): MindMapNode {
  const next = {
    ...node,
    children: node.children.map((child) => removeDeletedReferences(child, deletedIds)),
  };
  if (next.relativePlacement && deletedIds.has(next.relativePlacement.relativeTo)) {
    delete next.relativePlacement;
  }
  return next;
}

function validateCandidate(document: MindMapDocument) {
  return MindMapDocumentSchema.safeParse(document);
}

export function applyMindMapChangeSet(
  current: MindMapDocument | null,
  changeSet: MindMapChangeSet,
  options: ApplyChangeSetOptions,
): ApplyChangeSetResult {
  const currentRevision = current?.revision ?? 0;
  if (changeSet.baseRevision !== currentRevision) {
    return {
      document: current,
      appliedCommands: [],
      rejectedCommands: changeSet.commands.map((command) =>
        reject(
          command,
          'REVISION_CONFLICT',
          'ChangeSet base revision does not match the document.',
        ),
      ),
      revisionConflict: true,
    };
  }

  let document = current ? structuredClone(current) : null;
  const appliedCommands: MindMapCommand[] = [];
  const rejectedCommands: MindMapRejectedCommand[] = [];

  for (const command of changeSet.commands) {
    if (command.type === 'replaceDocument') {
      if (!options.allowReplace) {
        rejectedCommands.push(
          reject(
            command,
            'REPLACE_NOT_ALLOWED',
            'Replacing the document requires initialization or reset intent.',
          ),
        );
        continue;
      }
      const candidate: MindMapDocument = {
        ...structuredClone(command.document),
        schemaVersion: 2,
        revision: currentRevision + 1,
      };
      const checked = validateCandidate(candidate);
      if (!checked.success) {
        rejectedCommands.push(
          reject(command, 'INVALID_DOCUMENT', 'Replacement document failed validation.'),
        );
        continue;
      }
      document = checked.data;
      appliedCommands.push(command);
      continue;
    }

    if (!document) {
      rejectedCommands.push(
        reject(command, 'DOCUMENT_REQUIRED', 'Command requires an existing document.'),
      );
      continue;
    }

    const candidate = structuredClone(document);
    if (command.type === 'addNode') {
      if (!findMindMapNodeById(candidate, command.parentId)) {
        rejectedCommands.push(reject(command, 'PARENT_NOT_FOUND', 'Parent node does not exist.'));
        continue;
      }
      const existingIds = new Set(
        (() => {
          const ids: string[] = [];
          const visit = (node: MindMapNode) => {
            ids.push(node.id);
            node.children.forEach(visit);
          };
          visit(candidate.root);
          return ids;
        })(),
      );
      const addedIds = collectSubtreeIds(command.node);
      if ([...addedIds].some((nodeId) => existingIds.has(nodeId))) {
        rejectedCommands.push(
          reject(command, 'DUPLICATE_NODE_ID', 'Added node id already exists.'),
        );
        continue;
      }
      if (countMindMapNodes(candidate) + addedIds.size > MAX_MIND_MAP_NODES) {
        rejectedCommands.push(reject(command, 'NODE_LIMIT', 'Command exceeds the node limit.'));
        continue;
      }
      candidate.root = addChild(candidate.root, command.parentId, structuredClone(command.node));
    } else if (command.type === 'updateNode') {
      const target = findMindMapNodeById(candidate, command.nodeId);
      if (!target) {
        rejectedCommands.push(reject(command, 'NODE_NOT_FOUND', 'Update target does not exist.'));
        continue;
      }
      if (
        command.patch.relativePlacement &&
        (command.patch.relativePlacement.relativeTo === command.nodeId ||
          !findMindMapNodeById(candidate, command.patch.relativePlacement.relativeTo))
      ) {
        rejectedCommands.push(
          reject(command, 'INVALID_PLACEMENT', 'Relative placement target does not exist.'),
        );
        continue;
      }
      candidate.root = updateTree(candidate.root, command.nodeId, (node) =>
        applyPatch(node, command.patch),
      );
      if (candidate.root.id === command.nodeId && command.patch.title) {
        candidate.title = command.patch.title;
      }
    } else if (command.type === 'deleteNode') {
      if (candidate.root.id === command.nodeId) {
        rejectedCommands.push(reject(command, 'ROOT_PROTECTED', 'Root node cannot be deleted.'));
        continue;
      }
      const target = findMindMapNodeById(candidate, command.nodeId);
      if (!target) {
        rejectedCommands.push(reject(command, 'NODE_NOT_FOUND', 'Delete target does not exist.'));
        continue;
      }
      const deletedIds = collectSubtreeIds(target);
      const removed = removeNode(candidate.root, command.nodeId);
      candidate.root = removeDeletedReferences(removed.node, deletedIds);
      candidate.relations = candidate.relations.filter(
        (relation) => !deletedIds.has(relation.sourceId) && !deletedIds.has(relation.targetId),
      );
      candidate.groups = candidate.groups
        .map((group) => ({
          ...group,
          memberIds: group.memberIds.filter((nodeId) => !deletedIds.has(nodeId)),
        }))
        .filter((group) => group.memberIds.length > 0);
    } else if (command.type === 'moveNode') {
      if (candidate.root.id === command.nodeId) {
        rejectedCommands.push(reject(command, 'ROOT_PROTECTED', 'Root node cannot be moved.'));
        continue;
      }
      const moving = findMindMapNodeById(candidate, command.nodeId);
      const parent = findMindMapNodeById(candidate, command.newParentId);
      if (!moving || !parent) {
        rejectedCommands.push(
          reject(command, 'NODE_NOT_FOUND', 'Move target or parent does not exist.'),
        );
        continue;
      }
      if (moving.id === parent.id || nodeContains(moving, parent.id)) {
        rejectedCommands.push(reject(command, 'CYCLE', 'Move would create a cycle.'));
        continue;
      }
      const removed = removeNode(candidate.root, command.nodeId);
      if (!removed.removed) {
        rejectedCommands.push(
          reject(command, 'NODE_NOT_FOUND', 'Move target could not be removed.'),
        );
        continue;
      }
      candidate.root = addChild(removed.node, command.newParentId, removed.removed);
    } else if (command.type === 'upsertRelation') {
      candidate.relations = [
        ...candidate.relations.filter((relation) => relation.id !== command.relation.id),
        structuredClone(command.relation),
      ];
    } else if (command.type === 'deleteRelation') {
      if (!candidate.relations.some((relation) => relation.id === command.relationId)) {
        rejectedCommands.push(reject(command, 'RELATION_NOT_FOUND', 'Relation does not exist.'));
        continue;
      }
      candidate.relations = candidate.relations.filter(
        (relation) => relation.id !== command.relationId,
      );
    } else if (command.type === 'upsertGroup') {
      candidate.groups = [
        ...candidate.groups.filter((group) => group.id !== command.group.id),
        structuredClone(command.group),
      ];
    } else if (command.type === 'deleteGroup') {
      if (!candidate.groups.some((group) => group.id === command.groupId)) {
        rejectedCommands.push(reject(command, 'GROUP_NOT_FOUND', 'Group does not exist.'));
        continue;
      }
      candidate.groups = candidate.groups.filter((group) => group.id !== command.groupId);
    }

    candidate.revision = currentRevision + 1;
    const checked = validateCandidate(candidate);
    if (!checked.success) {
      rejectedCommands.push(
        reject(command, 'INVALID_RESULT', 'Command would produce an invalid document.'),
      );
      continue;
    }
    document = checked.data;
    appliedCommands.push(command);
  }

  if (document && appliedCommands.length > 0) {
    document = { ...document, revision: currentRevision + 1 };
  }

  return { document, appliedCommands, rejectedCommands, revisionConflict: false };
}
