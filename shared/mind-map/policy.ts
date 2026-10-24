import type {
  MindMapChangeSet,
  MindMapCommand,
  MindMapDocument,
  MindMapRejectedCommand,
  MindMapIntent,
} from './schema';
import {
  collectSubtreeIds,
  countMindMapNodes,
  findMindMapNodeById,
  subtreeContainsUserSource,
} from './selectors';

const RESET_PATTERN = /(清空|重置|重新开始|从头开始|抛弃.*现有|\breset\b|\bclear\b)/i;
const DELETE_PATTERN = /(删除|去掉|移除|删掉|\bremove\b|\bdelete\b)/i;

function isUntouchedDefaultDocument(document: MindMapDocument | null) {
  if (!document) return false;
  const { root } = document;
  return (
    document.title === '新思维导图' &&
    root.id === 'root' &&
    root.title === '新思维导图' &&
    root.content.trim() === '' &&
    root.kind === 'topic' &&
    root.status === 'open' &&
    root.source === 'user' &&
    root.children.length === 0 &&
    document.relations.length === 0 &&
    document.groups.length === 0
  );
}

export type GuardChangeSetResult = {
  acceptedCommands: MindMapCommand[];
  rejectedCommands: MindMapRejectedCommand[];
  allowReplace: boolean;
};

function rejected(command: MindMapCommand, code: string, reason: string): MindMapRejectedCommand {
  return { command, code, reason };
}

export function guardMindMapChangeSet(input: {
  current: MindMapDocument | null;
  changeSet: MindMapChangeSet;
  userInput: string;
  intent: MindMapIntent;
}): GuardChangeSetResult {
  // The client persists an empty root node so the canvas can render before the
  // first capture. It has no user facts to lose, so treat this exact pristine
  // shape as initialization while keeping replacement blocked everywhere else.
  const allowReplace =
    input.current === null ||
    isUntouchedDefaultDocument(input.current) ||
    RESET_PATTERN.test(input.userInput);
  const explicitDelete = DELETE_PATTERN.test(input.userInput);
  const acceptedCommands: MindMapCommand[] = [];
  const rejectedCommands: MindMapRejectedCommand[] = [];
  const totalNodes = countMindMapNodes(input.current);
  let deletedNodes = 0;

  for (const command of input.changeSet.commands) {
    if (command.type === 'replaceDocument' && !allowReplace) {
      rejectedCommands.push(
        rejected(
          command,
          'REPLACE_NOT_ALLOWED',
          'Document replacement requires explicit reset intent.',
        ),
      );
      continue;
    }

    if (command.type === 'deleteNode' && input.current) {
      const node = findMindMapNodeById(input.current, command.nodeId);
      if (!node) {
        acceptedCommands.push(command);
        continue;
      }
      if (!explicitDelete && input.intent !== 'batch') {
        rejectedCommands.push(
          rejected(
            command,
            'DELETE_NOT_REQUESTED',
            'Node deletion requires user intent or batch cleanup.',
          ),
        );
        continue;
      }
      if (!explicitDelete && subtreeContainsUserSource(node)) {
        rejectedCommands.push(
          rejected(
            command,
            'USER_FACT_PROTECTED',
            'Batch cleanup cannot delete unique user facts.',
          ),
        );
        continue;
      }
      const removed = collectSubtreeIds(node).size;
      if (totalNodes > 0 && deletedNodes + removed > totalNodes * 0.5) {
        rejectedCommands.push(
          rejected(
            command,
            'DELETE_BUDGET',
            'ChangeSet would delete more than half of the document.',
          ),
        );
        continue;
      }
      deletedNodes += removed;
    }

    acceptedCommands.push(command);
  }

  return { acceptedCommands, rejectedCommands, allowReplace };
}
